import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { handleInvitationEmail, invitationMessage, invitationSmtpOptions, openGmailSocket } from "../../workers/invitationEmail.mjs";

const token = "a".repeat(64);
const id = "00000000-0000-4000-8000-000000000001";
const origin = "https://cellar.example.test";
const env = { SMTP_USER: "sender@example.test", SMTP_PASSWORD: "secret", SUPABASE_URL: "https://db.example.test", SUPABASE_SECRET_KEY: "sb_secret_test" };
const invitation = { delivery_id: id, household_name: "Family <cellar>", invitee_email: "member@example.test", expires_at: "2026-09-14T12:00:00Z" };
function request(body = { invitationId: id, token }, headers = {}, method = "POST") {
  return new Request(`${origin}/api/household-invitations/email`, {
    method, headers: { origin, authorization: "Bearer session", "content-type": "application/json", ...headers },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
function setup({ authStatus = 200, claimStatus = 200, claimCode = "42501", smtpError, completionFails = false } = {}) {
  const calls = [], messages = [];
  let closed = false;
  const dependencies = {
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      if (url.endsWith("/user")) return Response.json({ id }, { status: authStatus });
      if (url.endsWith("claim_household_invitation_email")) return Response.json(claimStatus === 200 ? [invitation] : { code: claimCode }, { status: claimStatus });
      if (completionFails) throw new Error("offline");
      return new Response(null, { status: 204 });
    },
    createTransport: (options) => {
      assert.equal(options.auth.pass, "secret");
      return {
        sendMail: async (message) => { messages.push(message); if (smtpError) throw smtpError; return { accepted: [invitation.invitee_email] }; },
        close: () => { closed = true; },
      };
    },
  };
  return { dependencies, calls, messages, isClosed: () => closed };
}

test("authenticates the owner and sends only to the database recipient", async () => {
  const mock = setup();
  const response = await handleInvitationEmail(request(), env, mock.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(mock.calls[0].headers.authorization, "Bearer session");
  assert.deepEqual(JSON.parse(mock.calls[1].body), { p_actor_user_id: id, p_invitation_id: id, p_invitation_token: token });
  assert.equal(mock.calls[1].headers.authorization, undefined, "modern Supabase secret is not used as a JWT");
  assert.deepEqual(mock.messages[0].to, [{ address: invitation.invitee_email }]);
  assert.ok(mock.messages[0].text.includes(`${origin}/invite#token=${token}`));
  assert.equal(JSON.parse(mock.calls[2].body).p_status, "sent");
  assert.equal(mock.isClosed(), true);
  assert.ok(!(await response.text()).includes(token));
});
test("legacy service JWT uses the service Authorization header only for the private RPC", async () => {
  const mock = setup();
  await handleInvitationEmail(request(), { ...env, SUPABASE_SECRET_KEY: "a.b.c" }, mock.dependencies);
  assert.equal(mock.calls[0].headers.authorization, "Bearer session");
  assert.equal(mock.calls[1].headers.authorization, "Bearer a.b.c");
});
test("rejects missing sessions, cross-origin, injected fields, invalid tokens, and oversized JSON before SMTP", async () => {
  for (const [req, status] of [
    [request(undefined, { authorization: "" }), 401],
    [request(undefined, { origin: "https://attacker.example" }), 403],
    [request({ invitationId: id, token, email: "attacker@example.test" }), 400],
    [request({ invitationId: id, token, origin: "https://attacker.example" }), 400],
    [request({ invitationId: id, token: "bad" }), 400],
    [request({ invitationId: id, token: "a".repeat(3000) }), 413],
    [request(undefined, { "content-type": "text/plain" }), 415],
    [request(undefined, {}, "GET"), 405],
  ]) {
    const mock = setup();
    assert.equal((await handleInvitationEmail(req, env, mock.dependencies)).status, status);
    assert.equal(mock.messages.length, 0);
  }
});
test("no sending when configuration, authentication, ownership, token validity or limits fail", async () => {
  assert.equal((await handleInvitationEmail(request(), {})).status, 503);
  for (const [options, expected] of [
    [{ authStatus: 401 }, 401], [{ authStatus: 503 }, 503],
    [{ claimStatus: 403 }, 403], [{ claimStatus: 400, claimCode: "P0001" }, 429],
  ]) {
    const mock = setup(options);
    assert.equal((await handleInvitationEmail(request(), env, mock.dependencies)).status, expected);
    assert.equal(mock.messages.length, 0);
  }
});
test("provider rejection and uncertain delivery are distinguished without leaking error data or retrying", async () => {
  for (const [code, status] of [["EAUTH", "failed"], ["ETIMEDOUT", "unconfirmed"]]) {
    const mock = setup({ smtpError: Object.assign(new Error(`private ${token} secret`), { code }) });
    const response = await handleInvitationEmail(request(), env, mock.dependencies);
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(mock.calls[2].body).p_status, status);
    assert.equal(mock.messages.length, 1);
    assert.ok(!(await response.text()).includes(token));
    assert.ok(mock.isClosed());
  }
});
test("completion outage never automatically resends an accepted email", async () => {
  const mock = setup({ completionFails: true });
  assert.equal((await handleInvitationEmail(request(), env, mock.dependencies)).status, 200);
  assert.equal(mock.messages.length, 1);
});
test("email escapes names, keeps the token in a fragment, and explains new and existing accounts", () => {
  const message = invitationMessage(env, { ...invitation, household_name: '<img src=x>\r\nBcc: somebody' }, origin, token);
  assert.ok(!message.html.includes("<img"));
  assert.ok(message.html.includes("&lt;img"));
  assert.ok(!/[\r\n]/.test(message.subject));
  assert.ok(message.text.includes("New accounts must confirm"));
  assert.equal(new URL(message.text.match(/https:\/\/\S+/)[0]).search, "");
  const options = invitationSmtpOptions(env);
  assert.equal(options.secure, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.equal(options.logger, false);
});

test("emails use HTTPS even when the preview proxy exposes an HTTP origin", () => {
  for (const host of ["preview.trycloudflare.com", "cellarmanager.cellarcloud.workers.dev", "localhost.attacker.example"]) {
    const message = invitationMessage(env, invitation, `http://${host}`, token);
    assert.ok(message.text.includes(`https://${host}/invite#token=${token}`));
    assert.ok(message.html.includes(`href="https://${host}/invite#token=${token}"`));
    assert.ok(!message.text.includes(`http://${host}`));
  }
  const local = invitationMessage(env, invitation, "http://127.0.0.1:8796", token);
  assert.ok(local.text.includes("http://127.0.0.1:8796/invite#token="));
  assert.throws(() => invitationMessage(env, invitation, "file:///tmp", token), /Invalid application origin/);
});

test("Workers SMTP socket uses Gmail hostname and certificate verification; connection failures are sanitized", () => {
  for (const success of [true, false]) {
    const socket = new EventEmitter();
    const options = invitationSmtpOptions(env);
    let called = 0;
    openGmailSocket(options, (error, result) => {
      called++;
      if (success) {
        assert.equal(error, null);
        assert.equal(result.secured, true);
        assert.equal(result.connection, socket);
      } else {
        assert.equal(error.code, "ECONNECTION");
        assert.ok(!error.message.includes("private"));
      }
    }, (config) => {
      assert.equal(config.host, "smtp.gmail.com");
      assert.equal(config.servername, "smtp.gmail.com");
      assert.equal(config.rejectUnauthorized, true);
      return socket;
    });
    socket.emit(success ? "secureConnect" : "error", new Error("private error"));
    assert.equal(called, 1);
  }
});
