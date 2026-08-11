export class TokenRefreshError extends Error {
  isAuthFailure: boolean;

  constructor(message: string, isAuthFailure: boolean) {
    super(message);
    this.name = "TokenRefreshError";
    this.isAuthFailure = isAuthFailure;
  }
}
