namespace api.stream.addBarchart {
  type Action = 'subscribe' | 'unsubscribe' | 'touch';
  type Code = 'EACTION' | 'ELIMIT' | 'EPERIOD' | 'ESYMBOL';

  class CustomError extends DomainError {
    constructor(code?: Code);
    toJSON(): object;
  }
}
