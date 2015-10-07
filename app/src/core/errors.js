export class NetworkError extends Error {
  constructor( statusCode, message ) {
    super();
    this.name       = 'NetworkError';
    this.message    = message || 'Unknown HTTP Error';
    this.statusCode = statusCode || 500;
    this.stack      = (new Error()).stack;
  }
}

export class BadRequestError extends NetworkError {
  constructor( details ) {
    super( 400, 'Bad Request' );
    this.name    = 'BadRequestError';
    this.details = details;
  }
}

export class UnauthorizedError extends NetworkError {
  constructor() {
    super( 401, 'Unauthorized' );
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends NetworkError {
  constructor() {
    super( 403, 'Forbidden' );
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends NetworkError {
  constructor() {
    super( 404, 'Not Found' );
    this.name = 'NotFoundError';
  }
}

export class MethodNotAllowedError extends NetworkError {
  constructor() {
    super( 405, 'Method Not Allowed' );
    this.name = 'MethodNotAllowedError';
  }
}

export function errorFromXHR( xhr ) {
  if ( xhr.status ) {
    switch ( xhr.status ) {
      case 400:
        return new BadRequestError();
        break;

      case 401:
        return new UnauthorizedError();
        break;

      case 403:
        return new ForbiddenError();
        break;

      case 404:
        return new NotFoundError();
        break;

      case 405:
        return new MethodNotAllowedError();
        break;

      default:
        return new NetworkError( xhr.status, xhr.statusText );
        break;
    }
  } else {
    // Not an XHR
    return xhr;
  }
}