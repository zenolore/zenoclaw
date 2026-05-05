# 贡献指南 | Contributing Guide

感谢你对 ZenoClaw 的关注！我们欢迎各种形式的贡献。

## 如何贡献

### 报告问题

在 [Issues](https://github.com/zenolore/zenoclaw/issues) 中提交 bug 报告，请包含：

- 操作系统和 Node.js 版本
- 复现步骤
- 预期行为 vs 实际行为
- 相关日志或截图

### 添加新平台适配器

ZenoClaw 目前支持 19 个平台，欢迎为新平台编写适配器：

1. 在 `platforms/` 下创建新目录
2. 实现 `publisher.js`（继承 `BasePlatformAdapter`）和 `selectors.js`
3. 参考 `platforms/xiaohongshu/` 的结构
4. 提交 PR 时附上测试截图

### 提交代码

```bash
# 1. Fork 并克隆
git clone https://github.com/你的用户名/zenoclaw.git

# 2. 创建分支
git checkout -b feature/你的功能

# 3. 开发并测试
npm install
npm run api     # 启动 API 验证

# 4. 提交 PR
git push origin feature/你的功能
```

### 代码规范

- ES Module（`import/export`）
- 所有配置项从 `config.yaml` 读取，不硬编码
- 新功能需更新 `config.example.yaml` 中的配置说明
- 日志使用 `getLogger()` 而非 `console.log`

## Zeno 生态

ZenoClaw 是 [Zeno](https://zeno.babiku.xyz) 生态的开源自动化引擎。如果你也对 AI 内容创作感兴趣，可以了解完整的工作流：

> AI 生成文案 → SVG 海报设计 → ZenoClaw 自动发布到 19 个平台

## License

贡献的代码将以 [MIT License](LICENSE) 发布。
