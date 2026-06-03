// @ts-check
/**
 * 运行时适配层的占位错误。
 * M0 阶段所有方法均为空实现:被调用时显式抛此错误,而非返回假数据。
 */
export class NotImplementedError extends Error {
  /**
   * @param {string} method   形如 'rt.db.list'
   * @param {import('./types').Platform} platform
   */
  constructor(method, platform) {
    super(`${method} 在 ${platform} 端尚未实现(M0 骨架占位)`);
    this.name = 'NotImplementedError';
    this.method = method;
    this.platform = platform;
  }
}

/**
 * 异步方法的占位:返回一个被 NotImplementedError reject 的 Promise。
 * @param {string} method
 * @param {import('./types').Platform} platform
 * @returns {Promise<never>}
 */
export function notImpl(method, platform) {
  return Promise.reject(new NotImplementedError(method, platform));
}
