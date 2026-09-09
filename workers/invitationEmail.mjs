import nodemailer from "nodemailer";
import { connect } from "node:tls";

export function openGmailSocket(options, callback, connectSocket = connect) {
  // Let the Workers socket layer resolve the hostname. Pre-resolving to an IP
  // in Nodemailer can fail through the local runtime's outbound socket proxy.
  const socket = connectSocket({ host: "smtp.gmail.com", port: 465, ...options.tls });
  const timeout = setTimeout(() => socket.destroy(new Error("Connection timed out")), 10000);
  const fail = () => {
    clearTimeout(timeout);
    callback(Object.assign(new Error("Unable to connect to Gmail"), { code: "ECONNECTION" }));
  };
  socket.once("error", fail);
  socket.once("secureConnect", () => {
    clearTimeout(timeout);
    socket.removeListener("error", fail);
    callback(null, { connection: socket, secured: true });
  });
}

export function invitationSmtpOptions(env) {
  return {
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    tls: { servername: "smtp.gmail.com", minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    dnsTimeout: 10000, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true, maxRecipients: 1,
    getSocket: openGmailSocket,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function invitationMessage(env, invitation, origin, token) {
  const applicationUrl = new URL(origin);
  if (!["http:", "https:"].includes(applicationUrl.protocol)) throw new Error("Invalid application origin");
  // Wrangler's tunnel proxy can expose an HTTP request.url even when the
  // visitor used HTTPS. Always send secure public links, without trusting
  // forwarded host/protocol headers or accepting a client-chosen redirect.
  if (applicationUrl.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(applicationUrl.hostname)) {
    applicationUrl.protocol = "https:";
  }
  const url = `${applicationUrl.origin}/invite#token=${token}`;
  const name = invitation.household_name.replace(/[\r\n]/g, " ").slice(0, 200);
  const deadline = new Date(invitation.expires_at).toUTCString();
  return {
    from: { name: "CellarManager", address: env.SMTP_USER },
    to: [{ address: invitation.invitee_email }],
    subject: `Join ${name} on CellarManager`,
    text: `You are invited to join ${name} as a household member on CellarManager.\n\nOpen your invitation:\n${url}\n\nSign in if you already have an account, or create one using this email address. New accounts must confirm their email before joining.\n\nThis private link expires ${deadline}. Do not forward it: only the invited account can join. If you were not expecting this invitation, you can ignore it.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;line-height:1.6;color:#302429"><h1 style="font-size:24px">You’re invited to ${escapeHtml(name)}</h1><p>Join this household as a member on CellarManager.</p><p><a style="display:inline-block;background:#7c2943;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none" href="${escapeHtml(url)}">Open invitation</a></p><p>Sign in if you already have an account, or create one using this email address. New accounts must confirm their email before joining.</p><p>This private link expires ${escapeHtml(deadline)}. Only the invited account can join.</p><p>If you were not expecting this invitation, you can ignore it.</p></div>`,
  };
}

function reply(status, message) {
  return Response.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

function serviceHeaders(env) {
  const headers = { apikey: env.SUPABASE_SECRET_KEY, "content-type": "application/json" };
  if (env.SUPABASE_SECRET_KEY.split(".").length === 3) {
    headers.authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;
  }
  return headers;
}

export async function handleInvitationEmail(request, env, dependencies = {}) {
  if (request.method !== "POST") return reply(405, "Use POST to send an invitation.");
  const origin = new URL(request.url).origin;
  // Never accept a client-supplied redirect, body, recipient, or SMTP host.
  if (request.headers.get("origin") !== origin) return reply(403, "Open this invitation form in CellarManager.");
  if (!env.SMTP_USER || !env.SMTP_PASSWORD || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return reply(503, "Email sending is not configured yet. You can still copy the invitation link.");
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/.test(authorization)) return reply(401, "Sign in again before sending an invitation.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply(415, "Expected JSON.");
  let input;
  try {
    // Stream and bound the body even when Content-Length is absent/untrusted.
    const reader = request.body?.getReader();
    if (!reader) return reply(400, "Invalid invitation.");
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); return reply(413, "Invitation request is too large."); }
      chunks.push(value);
    }
    input = JSON.parse(await new Blob(chunks).text());
  } catch { return reply(400, "Invalid invitation."); }
  if (!input || !/^[0-9a-f-]{36}$/i.test(input.invitationId ?? "") ||
      !/^[0-9a-f]{64}$/.test(input.token ?? "") ||
      Object.keys(input).some((key) => !["invitationId", "token"].includes(key))) {
    return reply(400, "Invalid invitation.");
  }
  const fetcher = dependencies.fetch ?? fetch;
  const rpc = (name, body) => fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: serviceHeaders(env), body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let invitation;
  try {
    // Do not decode a JWT and trust its sub: verify with the configured Auth server.
    const auth = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SECRET_KEY, authorization }, signal: AbortSignal.timeout(10000),
    });
    if (!auth.ok) return reply(auth.status >= 500 ? 503 : 401, "Unable to verify your session. Please try again.");
    const user = await auth.json();
    if (!user.id) return reply(401, "Sign in again before sending an invitation.");
    const claim = await rpc("claim_household_invitation_email", {
      p_actor_user_id: user.id, p_invitation_id: input.invitationId, p_invitation_token: input.token,
    });
    if (!claim.ok) {
      const error = await claim.json();
      if (error.code === "P0001") return reply(429, "Please wait before sending again. Email limits are 20 per household and 50 overall per hour, with one per recipient per minute.");
      return reply(claim.status >= 500 ? 503 : 403, "This invitation cannot be emailed. Refresh the invitation list and check your owner access.");
    }
    [invitation] = await claim.json();
    if (!invitation?.delivery_id) return reply(503, "Unable to prepare the invitation email.");
  } catch { return reply(503, "Unable to prepare the invitation email. You can still copy the link."); }

  let outcome = "unconfirmed";
  const transport = (dependencies.createTransport ?? nodemailer.createTransport)(invitationSmtpOptions(env));
  try {
    const result = await transport.sendMail(invitationMessage(env, invitation, origin, input.token));
    outcome = result.accepted?.length === 1 ? "sent" : "failed";
  } catch (error) {
    // A disconnect after DATA may mean the email was accepted. Never retry
    // automatically or echo SMTP diagnostics, which can contain private data.
    outcome = ["EAUTH", "EENVELOPE", "EDNS", "ECONNECTION"].includes(error?.code) || error?.responseCode >= 400
      ? "failed" : "unconfirmed";
  } finally { transport.close(); }
  try { await rpc("complete_household_invitation_email", { p_delivery_id: invitation.delivery_id, p_status: outcome }); }
  catch { /* A stale sending attempt becomes unconfirmed in the owner projection. */ }
  if (outcome === "sent") return reply(200, "Invitation email sent. Ask the recipient to check their inbox and spam folder.");
  return reply(502, outcome === "failed"
    ? "The email could not be sent. Your invitation remains valid: copy its link or try sending again later."
    : "Email delivery could not be confirmed. Check the recipient’s inbox before trying again, or copy the same invitation link.");
}
