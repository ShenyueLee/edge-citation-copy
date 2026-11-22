# 开发日志

## 2026-11-22 — v1.1.0：知网适配与 GB/T 7714-2015 输出

### 反馈的问题

在知网（`kns.cnki.net/kcms2/article/abstract...`）复制时：

1. 作者信息显示为“未知作者”；
2. 链接包含很长的无用参数，例如 `v=...&uniplatform=NZKPT`；
3. 粘贴内容中包含大量多余空格和换行；
4. 引用格式不符合 GB/T 7714-2015（国内论文常用）。

### 本次修改

- 重写元数据提取逻辑，覆盖：
  - `citation_author`、`citation_journal_title`、`citation_volume`、`citation_issue`、`citation_firstpage`、`citation_lastpage`、`citation_doi` 等 Highwire meta；
  - JSON-LD；
  - 知网 DOM：`#authorpart`、`.brief .author`、`.wx-tit .author`、`.top-tip` 等；
  - 通用 `meta[name="author"]`、`[itemprop="author"]`、`[rel="author"]`。
- 作者字符串支持 `;`、`；`、`、`、中文逗号、空格等分隔方式，并清理上标编号、星号。
- 链接清理：
  - 知网优先使用 DOI；
  - 其次使用 canonical；
  - 再次使用 `dbcode` / `dbname` / `filename` 构造稳定链接；
  - 最后回退到当前 URL，并移除 `utm_*`、`uniplatform`、`language` 等跟踪参数。
- 空白清理：
  - 知网页面采用激进模式，合并段内换行、去掉汉字之间的空格；
  - 其他网站保留段落结构。
- 引用格式：
  - 期刊论文输出 `作者. 题名[J]. 刊名, 年, 卷(期): 页码. DOI/URL.`；
  - 网页输出 `作者. 题名[EB/OL]. (发布日期)[引用日期]. URL.`；
  - 超过 3 位作者按 GB/T 7714-2015 截取前 3 位，加“等”或“et al.”。
- 剪贴板同时写入 `text/plain` 和 `text/html`；HTML 中标题和 DOI/URL 为可点击锚文本。
- 只处理用户主动触发的复制事件（`event.isTrusted !== false`），避免干扰页面自己的复制按钮。

### 验证

- `node --check content.js` 通过。
- 使用模拟 DOM 的隔离测试验证了：
  - 知网 4 位作者、期刊、年、卷、期、页码、DOI 的提取；
  - 有 DOI 时生成 DOI 链接；
  - 无 DOI 时生成 `filename` 稳定链接；
  - GB/T 7714 期刊/网页引用格式；
  - 知网空白清理；
  - URL 跟踪参数移除。
- 当前环境无法访问真实知网页面，尚未进行线上页面验证。需要在 Edge 中重新加载扩展后，在知网文章页手动确认作者、期刊、DOI 与粘贴效果。

### 后续可做

- 如果知网改版，优先检查 `#authorpart`、`.brief .author`、`.wx-tit .author`、`.top-tip`。
- 可考虑增加会议论文 `[C]`、学位论文 `[D]` 的专用格式。
- 可考虑提供“列出全部作者”开关，以满足不采用 GB/T 7714 截断规则的场景。
