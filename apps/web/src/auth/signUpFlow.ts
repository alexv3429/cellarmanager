export interface SignUpSuccessState {
  nextMode: "sign-in" | "sign-up"
  clearPassword: boolean
  message: string | null
}

export function getSignUpEmailRedirectTo(
  applicationOrigin: string,
): string {
  const origin = new URL(applicationOrigin)

  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("The application origin must use HTTP or HTTPS")
  }

  return origin.origin
}

export function resolveSignUpSuccess(
  hasSession: boolean,
): SignUpSuccessState {
  if (hasSession) {
    return {
      nextMode: "sign-up",
      clearPassword: false,
      message: null,
    }
  }

  return {
    nextMode: "sign-in",
    clearPassword: true,
    message:
      "Check your email for a confirmation link, then sign in.",
  }
}
