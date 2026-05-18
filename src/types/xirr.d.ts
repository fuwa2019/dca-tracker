declare module 'xirr' {
  interface XirrEvent {
    amount: number;
    when: Date;
  }
  function xirr(events: XirrEvent[]): number;
  export default xirr;
}
