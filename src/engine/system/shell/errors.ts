export class ParseError extends Error {
  constructor(
    message: string,
    public pos: number | null = null
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export class SilentCommandError extends Error {
  constructor(public code = 1) {
    super('Command failed');
    this.name = 'SilentCommandError';
  }
}
