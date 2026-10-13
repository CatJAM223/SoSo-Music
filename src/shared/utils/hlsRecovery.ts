export type HlsRecoveryAction = 'reload' | 'recover' | 'fail';

/** Each source gets one network retry and one decoder recovery before URL refresh. */
export class HlsRecoveryBudget {
  private networkRetried = false;
  private mediaRetried = false;

  next(type: 'network' | 'media' | 'other'): HlsRecoveryAction {
    if (type === 'network' && !this.networkRetried) {
      this.networkRetried = true;
      return 'reload';
    }
    if (type === 'media' && !this.mediaRetried) {
      this.mediaRetried = true;
      return 'recover';
    }
    return 'fail';
  }
}
