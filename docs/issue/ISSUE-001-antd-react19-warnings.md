# ISSUE-001 控制台警告：Modal destroyOnClose 废弃 + antd v5 × React 19 兼容性

- 日期：2026-08-26
- 状态：已修复
- 严重级别：低（仅开发环境警告，不影响功能，但存在潜在弹出层渲染风险）
- 发现方式：浏览器控制台，冥想会话列表页（MeditationListPage）

## 一、缺陷现象

打开冥想会话列表页，控制台输出两条警告：

```
Warning: [antd: Modal] `destroyOnClose` is deprecated. Please use `destroyOnHidden` instead.
Warning: [antd: compatible] antd v5 support React is 16 ~ 18. see `https://u.ant.design/v5-for-19` for compatible.
```

## 二、定位分析

### 问题 1：`destroyOnClose` 已废弃

- **位置**：`frontend/src/pages/MeditationListPage.tsx:143`（重命名会话弹窗）
- **原因**：antd 5.25 起 Modal 的 `destroyOnClose` 属性更名为 `destroyOnHidden`（语义修正：关闭动画结束后销毁内容）。旧属性保留兼容但触发废弃警告
- **影响范围**：全局搜索确认仅此 1 处使用

### 问题 2：antd v5 与 React 19 兼容性

- **位置**：全局（运行时），触发于任何 antd 组件渲染
- **原因**：项目使用 React 19.1 + antd 5.26，而 antd v5 官方支持范围是 React 16~18。React 19 移除了 `ReactDOM.render`，影响 antd 的 Modal / Drawer / message / notification 等弹出层的内部渲染机制（`unstable_renderSubtreeIntoContainer` 等旧 API）
- **风险**：多数场景当前可正常运行，但存在已知边角问题（如 StrictMode 下 message 重复渲染、Modal 内嵌表格滚动异常等），且警告持续刷屏掩盖真实问题

## 三、修复方案

| # | 修改 | 文件 | 内容 |
| --- | --- | --- | --- |
| 1 | 属性改名 | `MeditationListPage.tsx:143` | `destroyOnClose` → `destroyOnHidden`（行为完全一致，纯改名） |
| 2 | 安装兼容补丁 | `package.json` | 新增依赖 `@ant-design/v5-patch-for-react-19` |
| 3 | 引入补丁 | `main.tsx` | 顶部 `import '@ant-design/v5-patch-for-react-19'`（必须先于任何 antd 组件渲染引入） |

补丁包为 antd 官方维护的正式兼容方案（非社区 hack）：接管 `ReactDOM.render` 移除后的静态方法渲染，升级 antd v6 时移除该补丁即可。

## 四、验证结果

- [x] 启动前端，冥想列表页控制台两条警告均消失
- [x] 重命名弹窗功能回归：打开/关闭/回车提交/保存 loading 正常
- [x] `pnpm lint` / `pnpm build` / `pnpm test`（23/23）全部通过

## 五、经验沉淀

- 项目脚手架选型 React 19 时，引入任何依赖前先查其官方 React 版本支持矩阵；antd v5 需配套 `@ant-design/v5-patch-for-react-19`
- antd 属性废弃警告遵循 semver 兼容承诺，按提示改名即可，无行为差异
