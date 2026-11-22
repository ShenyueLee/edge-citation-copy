# 学术引用复制助手

复制网页文本时，自动清理多余空白，并在末尾追加一条符合 **GB/T 7714-2015** 的来源引用。针对中国知网（CNKI）做了专门适配。

## 功能

- 自动提取标题、作者、期刊、年、卷、期、页码、DOI。
- 知网作者优先读取 `citation_author` 元数据；缺失时从页面作者区域提取，不再一律显示“未知作者”。
- 链接优先使用 DOI、canonical 或知网稳定链接，并移除 `utm_*`、`uniplatform`、`language` 等跟踪参数。
- 粘贴到 Word / WPS 等富文本编辑器时，只有标题会成为指向干净链接的可点击锚文本，不再复制单独的链接文本。
- 清理复制内容中的多余空格、换行、零宽字符；知网页面会额外合并段内换行、去掉汉字之间的排版空格。
- 按 GB/T 7714-2015 组织期刊论文和网页/电子资源引用。

## 安装

1. 打开 Edge，在地址栏访问 `edge://extensions/`。
2. 打开左下角的“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择本项目文件夹（包含 `manifest.json` 的文件夹）。
4. 安装完成后即可在网页中正常使用。
5. 修改代码后，回到 `edge://extensions/` 点击本扩展的“重新加载”即可生效。

## 使用

选中文本后按 `Ctrl+C`（或右键复制）。以知网期刊文章为例，纯文本粘贴结果：

```text
一段来自论文的原文。

张三, 李四, 王五, 等. 论文标题[J]. 计算机学报, 2023, 46(5): 1-10. DOI: 10.11897/SP.J.1016.2023.00001.
```

粘贴到 Word / WPS 等支持 HTML 剪贴板的软件时，只有 `论文标题` 会变成可点击的超链接；DOI 作为普通文本保留，不再复制单独的蓝色链接文本。

> Word 默认需要用 **Ctrl + 单击** 打开超链接，直接单击只会把光标放到链接上。如果希望单击打开，可在 Word 的“文件 → 选项 → 高级 → 编辑选项”中取消勾选“用 Ctrl + 单击跟踪超链接”。
>
> 粘贴时请选择“保留源格式”或“合并格式”，不要选择“只保留文本”，否则超链接会丢失。

## 引用格式

### 期刊论文

```text
作者. 题名[J]. 刊名, 年, 卷(期): 页码. DOI: xxx.
```

- 3 位以内作者全部列出；超过 3 位时按 GB/T 7714-2015 只列前 3 位，后加“等”（英文作者为“et al.”）。
- 有 DOI 时，末尾著录 DOI；没有 DOI 时，末尾追加干净链接。
- 没有作者信息时不写“未知作者”，直接以题名开头。
- 没有卷号时自动省略，例如 `刊名, 2023(5): 1-10`。
- 为避免与已有参考文献编号冲突，不会自动添加 “[1]” 这类序号。
- 富文本粘贴时只把题名做成超链接；纯文本粘贴仍保留 DOI/URL。

### 网页/其他电子资源

```text
作者. 题名[EB/OL]. (发布日期)[引用日期]. URL.
```

没有发布日期时只保留引用日期，例如：

```text
张三. 网页标题[EB/OL]. [2026-11-22]. https://example.com/article
```

## 元数据来源

| 字段 | 优先来源 | 回退来源 |
| --- | --- | --- |
| 标题 | `citation_title`、`dc.title`、`dcterms.title` | 知网 `.wx-tit h1`、`.brief h1`、`h1.title`、`#title`、`og:title`、`document.title` |
| 作者 | `citation_author`、`citation_authors`、`dc.creator`、`dcterms.creator` | 知网 `#authorpart`、`.brief .author`、`.wx-tit .author`、`.author`、`.author-list`、`.authors`、`.author-name`；“作者：”文本行；JSON-LD；`meta[name="author"]`、`[itemprop="author"]`、`[rel="author"]` |
| 期刊 | `citation_journal_title` | `dc.source`、知网 `.top-tip`、`.article-info`、`.journal-name` 等 |
| 年/卷/期/页码 | `citation_publication_date`、`citation_volume`、`citation_issue`、`citation_firstpage`、`citation_lastpage`、`citation_pages` | 知网 `.top-tip` 文本解析 |
| DOI | `citation_doi`、`dc.identifier`、`dcterms.identifier` | `.doi`、`[class*="doi"]`、`doi.org` 链接 |
| 链接 | 知网优先 DOI；其他站点优先 canonical | 知网 `filename` 稳定链接；当前 URL 去除跟踪参数 |

## 知网适配说明

### 作者

知网很多页面没有提供 `citation_author` 元数据，因此脚本会依次尝试：

1. `citation_author` / `dc.creator` 等元数据；
2. `#authorpart`、`.brief .author`、`.wx-tit .author` 等作者区域中的链接或文本；
3. 页面中的“作者：xxx”文本行；
4. 页面 JSON-LD；
5. 通用 `meta[name="author"]`、`[itemprop="author"]`、`[rel="author"]`。

作者名会按分号、顿号、逗号、空格等分隔符拆分，并清理上标编号和星号。脚本还会过滤以 `1.` 等编号开头的单位项，以及含“大学 / 学院 / 研究院 / University / College”等机构关键词的项，避免把机构当成作者。作者提取是完整的；输出到引用时，再按 GB/T 7714-2015 截取前 3 位并加“等”。

### 链接

- 有 DOI 时使用 `https://doi.org/<DOI>`，这是最短、最稳定的形式。
- 没有 DOI 时优先使用页面的 canonical 链接。
- 知网页面如果能找到 `dbcode` / `dbname` / `filename`，会构造较短的 `detail.aspx` 稳定链接。
- 最后才回退到当前 URL，并删除 `utm_*`、`uniplatform`、`language`、`spm` 等跟踪参数。
- 如果知网文章既没有 DOI，也没有 `filename`，当前 URL 中的 `v=` 访问令牌会被保留，否则链接无法打开。

### 空白清理

- 知网页面：把段内换行合并为空格，去掉汉字之间、汉字与中文标点之间的排版空格，只保留真正的空行分段。
- 其他网站：保留段落结构，清理行尾空白和连续空行。
- 两种模式都会移除 NBSP、零宽空格、BOM 等不可见字符。

## 已知限制

- 知网页面结构可能调整。如果作者、期刊等字段再次缺失，优先检查 `#authorpart`、`.brief .author`、`.wx-tit .author`、`.top-tip` 等选择器。
- 富文本锚文本依赖目标软件支持 HTML 剪贴板；Word、WPS 等通常支持，纯文本编辑器只能保留纯文本。
- Word 默认需要 **Ctrl + 单击** 打开超链接；如果单击标题没有跳转，请先确认这一点，或在 Word 选项中关闭“用 Ctrl + 单击跟踪超链接”。
- 页面通过 `execCommand('copy')` 等方式程序化触发复制时，本扩展不会干预，以免影响页面自己的“复制引用”按钮。
- 所有处理都在本地浏览器中完成，不会上传任何数据。

## 更新日志

- **2026-11-22 v1.1.2**：富文本引用只保留标题超链接，移除 DOI/URL 的可见链接文本；纯文本仍保留 DOI/URL。
- **2026-11-22 v1.1.1**：修复期刊名末尾多余标点（如 `生态学报 ., 2027`）、机构名混入作者列表、标题末尾“附视频”等徽标未清理的问题。
- **2026-11-22 v1.1.0**：新增知网作者 DOM 提取、链接清理、空白清理和 GB/T 7714-2015 引用格式。
- **v1.0.0**：初始版本，支持在复制的文本后追加标题、作者和链接。

完整开发记录见 [DEVLOG.md](DEVLOG.md)。
