export interface SignUpSuccessState {
  nextMode: "sign-in" | "sign-up"
  clearPassword: boolean
  message: string | null
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
