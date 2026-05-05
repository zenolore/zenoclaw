/**
 * 密码加密/解密工具
 *
 * 使用 AES-256-GCM 加密存储密码。
 * 加密密钥从配置文件的 api.key 或 security.secret 派生。
 *
 * 用法:
 *   import { encrypt, decrypt } from './crypto.js'
 *   const encrypted = encrypt('my-password')   // → 'aes256gcm:iv:authTag:ciphertext'
 *   const plain = decrypt(encrypted)            // → 'my-password'
 */
import crypto from 'crypto'
import { cfg } from './config.js'

const ALGORITHM = 'aes-256-gcm'
const PREFIX = 'aes256gcm:'

/**
 * 获取 32 字节加密密钥（从配置派生）
 *
 * 安全策略：
 *   优先使用 security.secret，其次 api.key。
 *   两者都未配置时抛出错误，禁止使用默认值。
 */
function getKey() {
  const secret = cfg('security.secret', '') || cfg('api.key', '')
  if (!secret) {
    throw new Error(
      '[Security] 加密密钥未配置！请在 zenoclaw.config.yaml 中设置 security.secret 或 api.key。\n' +
      '  示例:\n' +
      '  security:\n' +
      '    secret: "your-random-secret-at-least-32-chars"'
    )
  }
  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * 加密明文字符串
 * @param {string} plaintext
 * @returns {string} 格式: 'aes256gcm:iv_hex:authTag_hex:ciphertext_hex'
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext
  if (isEncrypted(plaintext)) return plaintext

  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * 解密已加密的字符串
 * @param {string} encryptedStr
 * @returns {string} 明文
 */
export function decrypt(encryptedStr) {
  if (!encryptedStr) return encryptedStr
  if (!isEncrypted(encryptedStr)) return encryptedStr

  const parts = encryptedStr.slice(PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error('无效的加密格式')

  const [ivHex, authTagHex, cipherHex] = parts
  const key = getKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * 判断字符串是否已加密
 */
export function isEncrypted(str) {
  return typeof str === 'string' && str.startsWith(PREFIX)
}
