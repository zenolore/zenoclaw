/**
 * 统一任务状态机 — publish / browse / interact 共享生命周期
 *
 * 状态流转:
 *   scheduled → queued → running → success / failed
 *                                ↗ (retry)
 *
 * 所有任务类型共享此状态枚举和转换规则，
 * 避免 browse 用 "completed" 而 publish 用 "success" 的不一致。
 */

/** 合法任务状态 */
export const TaskStatus = Object.freeze({
  SCHEDULED: 'scheduled',   // 等待定时触发
  QUEUED:    'queued',       // 排队等待执行
  RUNNING:   'running',      // 正在执行
  SUCCESS:   'success',      // 执行成功
  FAILED:    'failed',       // 执行失败
})

/** 合法任务类型 */
export const TaskType = Object.freeze({
  PUBLISH:  'publish',
  BROWSE:   'browse',
  INTERACT: 'interact',
  STATS:    'collect_stats',
})

/** 合法状态转换表 */
const VALID_TRANSITIONS = {
  [TaskStatus.SCHEDULED]: [TaskStatus.QUEUED, TaskStatus.FAILED],
  [TaskStatus.QUEUED]:    [TaskStatus.RUNNING, TaskStatus.FAILED],
  [TaskStatus.RUNNING]:   [TaskStatus.SUCCESS, TaskStatus.FAILED],
  // 终态不允许再转换（除非 retry）
  [TaskStatus.SUCCESS]:   [],
  [TaskStatus.FAILED]:    [TaskStatus.QUEUED], // 允许重试
}

/**
 * 创建标准化的任务对象
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.type       - TaskType 枚举值
 * @param {string} opts.platform
 * @param {string} [opts.status]   - 初始状态，默认 QUEUED
 * @param {object} [opts.payload]  - 任务特定数据（title, content, action 等）
 * @returns {object}
 */
export function createTask({ taskId, type, platform, status, payload = {} }) {
  return {
    task_id: taskId,
    type,
    platform,
    status: status || TaskStatus.QUEUED,
    payload,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
  }
}

/**
 * 安全地转换任务状态，违规转换抛出错误
 * @param {object} task    - 任务对象（会被 mutate）
 * @param {string} newStatus - 目标状态
 * @param {object} [extra]   - 附加字段（result / error）
 * @returns {object} 更新后的 task
 */
export function transitionTask(task, newStatus, extra = {}) {
  const allowed = VALID_TRANSITIONS[task.status]
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `[TaskLifecycle] 非法状态转换: ${task.task_id} (${task.status} → ${newStatus})，` +
      `允许: [${(allowed || []).join(', ')}]`
    )
  }

  task.status = newStatus

  if (newStatus === TaskStatus.RUNNING) {
    task.started_at = new Date().toISOString()
  }

  if (newStatus === TaskStatus.SUCCESS || newStatus === TaskStatus.FAILED) {
    task.completed_at = new Date().toISOString()
  }

  if (extra.result !== undefined) task.result = extra.result
  if (extra.error !== undefined) task.error = extra.error

  return task
}

/**
 * 判断任务是否处于终态
 */
export function isTerminal(task) {
  return task.status === TaskStatus.SUCCESS || task.status === TaskStatus.FAILED
}

/**
 * 包装异步执行函数，自动管理 running → success/failed 状态转换
 * @param {object} task     - 任务对象
 * @param {Function} fn     - async (task) => result 的执行函数
 * @param {object} [opts]
 * @param {Function} [opts.onStart]    - 开始回调
 * @param {Function} [opts.onSuccess]  - 成功回调 (task, result)
 * @param {Function} [opts.onFail]     - 失败回调 (task, error)
 * @returns {Promise<object>} 更新后的 task
 */
export async function executeWithLifecycle(task, fn, opts = {}) {
  transitionTask(task, TaskStatus.RUNNING)
  if (opts.onStart) await opts.onStart(task)

  try {
    const result = await fn(task)
    transitionTask(task, TaskStatus.SUCCESS, { result })
    if (opts.onSuccess) await opts.onSuccess(task, result)
  } catch (err) {
    transitionTask(task, TaskStatus.FAILED, { error: err.message })
    if (opts.onFail) await opts.onFail(task, err)
  }

  return task
}
