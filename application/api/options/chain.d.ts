namespace api.options.chain {
  type Action = 'subscribe' | 'unsubscribe' | 'touch';
  type Code = 'EACTION' | 'ESPREADTYPE' | 'ESYMBOL';

  class CustomError extends DomainError {
    constructor(code?: Code);
    toJSON(): object;
  }
}
