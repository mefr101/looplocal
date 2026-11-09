// An error that carries an HTTP status. The central handler in server.js turns it
// into a JSON response, so services can say "409 Conflict" without touching Express.
// `fields` (optional) maps form field names to messages, for inline form errors.
export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
