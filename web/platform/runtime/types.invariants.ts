/**
 * 隐私不变量的**编译期断言**。
 * 这些不是运行时测试,而是类型断言:任一条被破坏,`tsc --noEmit` 立即失败,
 * CI 的 typecheck 关卡拦下改动。固化「安全与隐私模型」的两条红线。
 */
import type { SecretApi, Collection } from './types';

// 红线 1:SecretApi 绝不能出现 get() —— 明文密钥不得从类型层回到前端。
//         若有人给 SecretApi 加了 get,keyof 含 'get' → 类型变 never → 下行报错。
type AssertNoSecretGet = 'get' extends keyof SecretApi ? never : true;
const _noSecretGet: AssertNoSecretGet = true;

// 红线 2:通用数据集合 Collection 绝不能包含 'profile' —— 隐私字段走独立隔离仓库,
//         不经通用 rt.db,AI 永不读取。
type AssertNoProfileCollection = 'profile' extends Collection ? never : true;
const _noProfileCollection: AssertNoProfileCollection = true;

// 标记已用,避免 noUnusedLocals 噪声(关卡价值在上面的类型求值)。
void _noSecretGet;
void _noProfileCollection;
