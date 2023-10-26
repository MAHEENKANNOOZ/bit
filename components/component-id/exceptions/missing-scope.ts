export class MissingScope extends Error {
  constructor(src: any) {
    super(`scope is missing from a component-id "${src.toString()}".
in case you just upgraded bit version to >= 1.2.10 and you're getting this error, please run "bit cc" and then "bit status" to fix it`);
  }
  report() {
    return this.message;
  }
}
