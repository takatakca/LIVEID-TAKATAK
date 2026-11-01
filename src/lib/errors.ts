/** An error that is safe to show to the browser: a stable code plus an HTTP status. */
export class FlowError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}
