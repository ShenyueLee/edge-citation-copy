/**
 * 学术引用复制助手 - 内容脚本
 *
 * 工作流程：
 * 1. 监听页面上的 copy 事件（包括 Ctrl+C 和右键菜单中的“复制”）；
 * 2. 读取用户选中的文本，并提取标题、作者、期刊、年卷期、页码、DOI 等元数据；
 * 3. 清理复制文本中的多余空白，按 GB/T 7714-2015 组织引用信息；
 * 4. 阻止浏览器默认的复制行为，同时写入纯文本和富文本剪贴板。
 *
 * 知网（CNKI）适配：
 * - 作者等信息优先读取 citation_* 元数据；缺失时从知网页面 DOM 中提取；
 * - 链接优先使用 DOI、canonical 或知网稳定链接，并移除跟踪参数；
 * - 富文本粘贴时，标题会变成指向来源链接的锚文本。
 */
(() => {
  'use strict';

  const UNKNOWN_TITLE = '未知标题';
  // GB/T 7714-2015 规定：超过 3 位作者时只列前 3 位，后加“等”或“et al.”。
  const MAX_LISTED_AUTHORS = 3;
  const CNKI_HOST_RE = /(^|\.)cnki\.net$/i;
  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  // 常见的跟踪参数。知网的 uniplatform、language 也属于这一类。
  // 机构、地址、角色等非作者信息，避免把“1.南京师范大学…”当成作者。
  const AFFILIATION_RE =
    /(?:大学|学院|学校|中学|小学|幼儿园|党校|研究院|研究所|研究中心|实验室|科学院|工程院|学会|协会|委员会|出版社|编辑部|杂志社|医院|公司|集团|银行|政府|教育厅|教育局|管理局|办公室|教研室|课题组|附属|校区|分校|中心|基地|系)/;
  const AFFILIATION_EN_RE =
    /\b(?:University|College|Institute|Academy|School|Department|Faculty|Laborator(?:y|ies)|Hospital|Ministry|Government|Company|Corp(?:oration)?|Inc|Ltd|Lab)\b/i;
  const AFFILIATION_PREFIX_RE = /^[\(\（]?\d+[\)\）]?[.、,，:：\s]/;
  const CONTACT_RE = /(?:@|https?:\/\/|邮编|邮箱|电子邮箱|地址\s*[:：])/i;
  const ROLE_RE =
    /(?:教授|副教授|讲师|助教|博士|硕士|研究员|副研究员|院士|工程师|高级工程师|主任|副主任|院长|副院长|所长|副所长|处长|副处长|书记|副书记|编辑|编审|记者)/;

  // 知网标题末尾的“附视频”“网络首发”等徽标。
  const TITLE_BADGE_RE =
    /\s*(?:[\(\（【]?\s*(?:附视频|附音频|附数据|网络首发|优先出版|增强出版)\s*[\)\）】]?)\s*$/i;

  // 让粘贴内容继承目标段落的字体、字号、字重、行高，而不是固定成网页样式。
  const INHERIT_FONT_STYLE =
    'font-family:inherit;font-size:inherit;font-weight:inherit;font-style:inherit;line-height:inherit;';

  const TRACKING_PARAMS = new Set([
    'uniplatform',
    'language',
    'lang',
    'spm',
    'scm',
    'from',
    'source',
    'ref',
    'refer',
    'referrer',
    'share',
    'share_token',
    'sharetoken',
    'timestamp',
    '_t',
    't',
    'sessionid',
    'session_id',
    'clicktime',
    'enterid',
    'kds',
    'isappinstalled',
    'mpshare',
    'scene',
    'srcid',
    'sharer_sharetime',
    'sharer_shareid',
    'chksm',
    'exportkey',
    'pass_ticket',
    'wx_header',
    'ascene',
    'devicetype',
    'nettype',
    'abtest_cookie'
  ]);

  // ---------------------------------------------------------------------------
  // 文本处理
  // ---------------------------------------------------------------------------

  /**
   * 去掉零宽字符和不可见空格，但不做其他格式调整。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function removeInvisibleChars(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\u2060\ufeff]/g, '');
  }

  /**
   * 把文本压成一行，用于标题、作者、期刊名等元数据。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function cleanInlineText(value) {
    return removeInvisibleChars(value).replace(/\s+/g, ' ').trim();
  }

  /**
   * 去掉汉字之间、汉字与中文标点之间由网页排版产生的多余空格。
   *
   * @param {string} value
   * @returns {string}
   */
  function stripCjkSpaces(value) {
    return String(value == null ? '' : value)
      .replace(
        /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]) (?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g,
        '$1'
      )
      .replace(/\s+([，。；：、！？）》」』】])/g, '$1')
      .replace(/([（《「『【])\s+/g, '$1')
      .replace(
        /([，。；：、！？）》」』】])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g,
        '$1'
      )
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /**
   * 清理用户选中的文本。
   *
   * CNKI 页面经常把每个字或每一行包在独立元素里，复制后会带出大量换行。
   * 因此知网页面采用更激进的策略：把段内换行合并为空格，并去掉汉字之间的空格；
   * 其他网站则保留段落结构，只清理行尾空白和连续空行。
   *
   * @param {string} value 原始选中文本
   * @param {boolean} aggressive 是否按知网场景激进清理
   * @returns {string}
   */
  function normalizeCopiedText(value, aggressive) {
    const raw = removeInvisibleChars(value).replace(/\r\n?/g, '\n');

    if (aggressive) {
      return raw
        .split(/\n\s*\n+/)
        .map((paragraph) =>
          stripCjkSpaces(paragraph.replace(/\s+/g, ' ').trim())
        )
        .filter(Boolean)
        .join('\n');
    }

    return raw
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 转义 HTML 特殊字符，避免选中文本中的标签被当成富文本执行。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[character])
    );
  }

  /**
   * 把日期归一化为 YYYY-MM-DD；无法识别时返回空字符串。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeDate(value) {
    const text = cleanInlineText(value);
    const match = text.match(
      /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/
    );

    if (!match) {
      return '';
    }

    const month = String(match[2]).padStart(2, '0');
    const day = String(match[3]).padStart(2, '0');
    return `${match[1]}-${month}-${day}`;
  }

  /**
   * 当前日期，用于 GB/T 7714 的“[引用日期]”。
   *
   * @returns {string}
   */
  function todayString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  /**
   * 从任意文本中提取四位年份。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function extractYear(value) {
    const match = String(value == null ? '' : value).match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : '';
  }

  /**
   * 归一化卷号、期号，去掉“第”“卷”“期”等字样和前导零。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeIssuePart(value) {
    const text = cleanInlineText(value);
    if (!text) {
      return '';
    }

    const match = text.match(/\d+[A-Za-z]?/);
    if (!match) {
      return text;
    }

    return match[0].replace(/^0+(?=\d)/, '');
  }

  /**
   * 归一化页码，例如 “1-10”“1–10”“1~10” 都输出 “1-10”。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function normalizePages(value) {
    const text = cleanInlineText(value);
    if (!text) {
      return '';
    }

    const range = text.match(/(\d+)\s*[-–—~]\s*(\d+)/);
    if (range) {
      return `${range[1]}-${range[2]}`;
    }

    const single = text.match(/\d+/);
    return single ? single[0] : '';
  }

  /**
   * 从文本中提取 DOI。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function extractDoi(value) {
    const match = String(value == null ? '' : value).match(
      /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i
    );

    return match ? match[0].replace(/[.,;:]+$/, '') : '';
  }

  /**
   * 去重，保留首次出现的顺序。
   *
   * @param {string[]} values
   * @returns {string[]}
   */
  function dedupe(values) {
    const seen = new Set();
    const result = [];

    for (const value of values) {
      const key = String(value).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(value);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // 元数据读取
  // ---------------------------------------------------------------------------

  /**
   * 读取一组 meta 标签的 content 值。
   *
   * 同时兼容 name、property、itemprop 三种写法，并忽略大小写。
   *
   * @param {string[]} names
   * @returns {string[]}
   */
  function getMetaValues(names) {
    const values = [];

    for (const name of names) {
      const selector = [
        `meta[name="${name}" i]`,
        `meta[property="${name}" i]`,
        `meta[itemprop="${name}" i]`
      ].join(', ');

      for (const node of document.querySelectorAll(selector)) {
        const content = node.getAttribute('content');
        if (content && content.trim()) {
          values.push(content.trim());
        }
      }
    }

    return values;
  }

  /**
   * 读取一组 meta 标签中的第一个非空值。
   *
   * @param {string[]} names
   * @returns {string}
   */
  function getFirstMeta(names) {
    const values = getMetaValues(names);
    return values.length > 0 ? values[0] : '';
  }

  /**
   * 拆分作者字符串。
   *
   * 知网中文作者通常用分号、顿号或中文逗号分隔；英文作者可能写成
   * “Smith, John”，因此不能简单按逗号拆分所有字符串。
   *
   * @param {unknown} raw
   * @returns {string[]}
   */
  function splitAuthorString(raw) {
    const cleaned = cleanInlineText(raw)
      .replace(/[\(\（][\d,，\s]+[\)\）]/g, '')
      .replace(/([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\d+(?:[,，]\d+)*/g, '$1')
      .replace(/^(?:作者|authors?|by)\s*[:：]?\s*/i, '')
      .trim();

    if (!cleaned) {
      return [];
    }

    let parts = cleaned.split(/\s*[;；、]\s*/);

    if (parts.length === 1) {
      // “张三, 李四, 等”“张三1, 李四2” 这类中文作者列表。
      const chineseCommaList =
        /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff·]{1,10}[\d*†‡]*(?:\s*[,，]\s*[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff·]{1,10}[\d*†‡]*)+$/;

      if (chineseCommaList.test(cleaned)) {
        parts = cleaned.split(/\s*[,，]\s*/);
      }
    }

    // 作者列表中混入“1.南京师范大学”这类单位时，严格匹配会失败，
    // 这里做一次更宽松的逗号拆分，随后由 normalizeAuthorName 过滤单位。
    if (parts.length === 1 && CJK_RE.test(cleaned) && /[,，]/.test(cleaned)) {
      const commaParts = cleaned.split(/\s*[,，]\s*/).filter(Boolean);
      const hasAffiliation = commaParts.some(
        (part) =>
          AFFILIATION_RE.test(part) ||
          AFFILIATION_EN_RE.test(part) ||
          AFFILIATION_PREFIX_RE.test(part)
      );

      if (commaParts.length > 1 && hasAffiliation) {
        parts = commaParts;
      }
    }

    if (parts.length === 1) {
      // “张三 李四”“张三1 李四2” 这类用空格分隔的中文作者。
      const tokens = cleaned.split(/\s+/);
      const allChineseNames = tokens.every(
        (token) =>
          token === '等' ||
          /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff·]{2,4}[\d*†‡]*$/.test(token)
      );
      const hasAffiliation = tokens.some(
        (token) =>
          AFFILIATION_RE.test(token) ||
          AFFILIATION_EN_RE.test(token) ||
          AFFILIATION_PREFIX_RE.test(token)
      );

      if (
        tokens.length > 1 &&
        (allChineseNames || (CJK_RE.test(cleaned) && hasAffiliation))
      ) {
        parts = tokens;
      }
    }

    return dedupe(parts.map(normalizeAuthorName).filter(Boolean));
  }

  /**
   * 清理单个作者名：去掉标签、上标编号、星号等。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeAuthorName(value) {
    let result = cleanInlineText(value)
      .replace(/^[\s,，;；、]+|[\s,，;；、]+$/g, '')
      .replace(/^(?:作者|authors?|by)\s*[:：]?\s*/i, '')
      .trim();

    // 去掉 “张三 1.南京师范大学” 这类与单位编号粘连的内容。
    result = result.replace(/\s*\d+[.、].*$/, '').trim();

    if (!result) {
      return '';
    }

    // 去掉 “张三(1)” 这类上标编号。
    result = result.replace(/[\(\（]\d+[\)\）]$/g, '').trim();

    // 去掉 “张三(通讯作者)” 这类角色标注。
    result = result
      .replace(
        /[\(\（](?:通讯作者|通信作者|第一作者|共同作者|作者)[\)\）]$/g,
        ''
      )
      .trim();

    if (CJK_RE.test(result)) {
      result = stripCjkSpaces(result)
        .replace(/\s*·\s*/g, '·')
        .replace(/\s+([.。])/g, '$1')
        .replace(/[.。]+$/g, '')
        .replace(/[\d*†‡,，;；]+$/g, '')
        .trim();
    } else {
      result = result.replace(/[*†‡]+$/g, '').trim();
    }

    if (!result || result.length > 80) {
      return '';
    }

    if (
      AFFILIATION_RE.test(result) ||
      AFFILIATION_EN_RE.test(result) ||
      AFFILIATION_PREFIX_RE.test(result) ||
      CONTACT_RE.test(result) ||
      ROLE_RE.test(result)
    ) {
      return '';
    }

    if (CJK_RE.test(result) && /\d/.test(result)) {
      return '';
    }

    if (
      /^(?:作者|作者姓名|作者单位|通讯作者|通信作者|第一作者|全部作者|单位|机构|摘要|关键词|期刊|导航|首页|登录|注册|下载|收藏|引用|分享|展开|更多|中国知网|CNKI|知网|Google Scholar|百度学术|n\/a|none|null|未知作者|未知)$/i.test(
        result
      )
    ) {
      return '';
    }

    if (/[。！？!?]/.test(result)) {
      return '';
    }

    return result;
  }

  /**
   * 从 JSON-LD 中提取作者。
   *
   * @param {unknown} node
   * @param {string[]} output
   */
  function collectJsonLdAuthors(node, output) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        collectJsonLdAuthors(item, output);
      }
      return;
    }

    if (node['@graph']) {
      collectJsonLdAuthors(node['@graph'], output);
    }

    const author = node.author || node.creator;
    if (!author) {
      return;
    }

    const list = Array.isArray(author) ? author : [author];
    for (const item of list) {
      if (typeof item === 'string') {
        output.push(...splitAuthorString(item));
      } else if (item && typeof item.name === 'string') {
        output.push(...splitAuthorString(item.name));
      }
    }
  }

  /**
   * 读取页面中所有 JSON-LD 里的作者。
   *
   * @returns {string[]}
   */
  function extractJsonLdAuthors() {
    const output = [];

    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]'
    )) {
      try {
        collectJsonLdAuthors(JSON.parse(script.textContent), output);
      } catch (error) {
        // 忽略无法解析的 JSON-LD。
      }
    }

    return dedupe(output);
  }

  /**
   * 从某个 DOM 元素中提取作者名。优先取链接文本，其次解析整段文字。
   *
   * @param {Element | null} element
   * @returns {string[]}
   */
  function extractAuthorsFromElement(element) {
    if (!element) {
      return [];
    }

    const links = element.matches('a')
      ? [element]
      : Array.from(element.querySelectorAll('a'));

    const fromLinks = links
      .map((link) => normalizeAuthorName(link.textContent))
      .filter(Boolean);

    if (fromLinks.length > 0) {
      return dedupe(fromLinks);
    }

    const text = cleanInlineText(element.textContent)
      .replace(/^\s*(?:作者|authors?|by)\s*[:：]?\s*/i, '')
      .replace(/\s*(?:作者单位|单位|机构|摘要|关键词)\s*[:：].*$/i, '');

    return splitAuthorString(text);
  }

  /**
   * 在知网页面中查找 “作者：xxx” 这一行，作为最后的兜底方案。
   *
   * @returns {string[]}
   */
  function findAuthorLine() {
    const roots = document.querySelectorAll(
      '.brief, .wx-tit, .article-header, .article-info, article, main'
    );

    for (const root of roots) {
      const nodes = root.querySelectorAll('div, p, span, li');
      let checked = 0;

      for (const node of nodes) {
        checked += 1;
        if (checked > 500) {
          break;
        }

        const text = cleanInlineText(node.textContent);
        if (text.length > 300) {
          continue;
        }

        if (/^(?:作者|authors?)\s*[:：]/i.test(text)) {
          const authors = splitAuthorString(text);
          if (authors.length > 0) {
            return authors;
          }
        }
      }
    }

    return [];
  }

  /**
   * 提取作者。
   *
   * 顺序：citation_* / 通用 meta → JSON-LD → 知网作者区域 → 通用作者区域。
   *
   * @param {boolean} isCnkiArticle
   * @returns {string[]}
   */
  function extractAuthors(isCnkiArticle) {
    // 学术站点常用的 citation_* / dc.creator 元数据最可靠。
    const citationAuthors = getMetaValues([
      'citation_author',
      'citation_authors',
      'dc.creator',
      'dcterms.creator'
    ]).flatMap(splitAuthorString);

    if (citationAuthors.length > 0) {
      return dedupe(citationAuthors);
    }

    // 知网页面的作者区域比通用 meta[name="author"] 和 JSON-LD 更准确。
    if (isCnkiArticle) {
      const cnkiContainers = [];

      for (const selector of [
        '#authorpart',
        '.brief .author',
        '.wx-tit .author',
        '.article-header .author',
        '.author-list',
        '.authors',
        '.author-name',
        'a.author'
      ]) {
        cnkiContainers.push(...document.querySelectorAll(selector));
      }

      // 有些模板没有上述结构，退回到页面中第一个 .author。
      if (cnkiContainers.length === 0) {
        const fallback = document.querySelector('.author');
        if (fallback) {
          cnkiContainers.push(fallback);
        }
      }

      const cnkiAuthors = [];
      for (const container of cnkiContainers) {
        cnkiAuthors.push(...extractAuthorsFromElement(container));
      }

      if (cnkiAuthors.length > 0) {
        return dedupe(cnkiAuthors);
      }

      const lineAuthors = findAuthorLine();
      if (lineAuthors.length > 0) {
        return lineAuthors;
      }
    }

    const jsonLdAuthors = extractJsonLdAuthors();
    if (jsonLdAuthors.length > 0) {
      return jsonLdAuthors;
    }

    // 通用 meta 放在知网 DOM 之后，避免把“中国知网”等站点名当成作者。
    const genericMetaAuthors = getMetaValues([
      'author',
      'article:author',
      'og:article:author'
    ]).flatMap(splitAuthorString);

    if (genericMetaAuthors.length > 0) {
      return dedupe(genericMetaAuthors);
    }

    const genericContainers = [
      document.querySelector('[itemprop="author"]'),
      document.querySelector('[rel="author"]'),
      document.querySelector('.article-author'),
      document.querySelector('.byline'),
      document.querySelector('.author-list'),
      document.querySelector('.authors'),
      document.querySelector('.author-name')
    ];

    for (const container of genericContainers) {
      const authors = extractAuthorsFromElement(container);
      if (authors.length > 0) {
        return authors;
      }
    }

    return [];
  }

  /**
   * 清理网页标题：去掉知网等站点附加的站点名。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function cleanPageTitle(value) {
    return stripCjkSpaces(cleanInlineText(value))
      .replace(TITLE_BADGE_RE, '')
      .replace(
        /\s*[-_|—–]\s*(?:中国知网|CNKI|知网|Google Scholar|百度学术)\s*$/i,
        ''
      )
      .trim();
  }

  /**
   * 提取标题。
   *
   * @param {boolean} isCnkiArticle
   * @returns {string}
   */
  function extractTitle(isCnkiArticle) {
    const metadataTitle = getFirstMeta([
      'citation_title',
      'dc.title',
      'dcterms.title'
    ]);

    if (metadataTitle) {
      return cleanPageTitle(metadataTitle);
    }

    if (isCnkiArticle) {
      const selectors = [
        '.wx-tit h1',
        '.brief h1',
        'h1.title',
        '#title',
        'h1'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const text = element ? cleanPageTitle(element.textContent) : '';
        if (text) {
          return text;
        }
      }
    }

    const ogTitle = getFirstMeta(['og:title']);
    if (ogTitle) {
      return cleanPageTitle(ogTitle);
    }

    return cleanPageTitle(document.title) || UNKNOWN_TITLE;
  }

  /**
   * 清理期刊名。fromText 为 true 时，会截掉后面附带的年份、卷期信息。
   *
   * @param {unknown} value
   * @param {boolean} [fromText]
   * @returns {string}
   */
  function cleanJournal(value, fromText) {
    let text = cleanInlineText(value)
      .replace(/^(?:期刊名称|期刊|刊名|来源)\s*[:：]\s*/i, '')
      .replace(/^[《【“"']+|[》】”"']+$/g, '')
      .replace(
        /^(?:中国知网|CNKI|知网|网络首发|优先出版|增强出版|期刊导航)\s*/i,
        ''
      )
      .trim();

    if (fromText) {
      const cut = text.split(
        /\s*(?:19|20)\d{2}\s*年|\s*(?:19|20)\d{2}\s*[,，]|\s*第?\s*\d+\s*卷|\s*第?\s*\d+\s*期/
      )[0];

      if (cut && cut.length >= 2) {
        text = cut;
      }
    }

    text = stripCjkSpaces(text)
      .replace(/^[《【“"']+|[》】”"']+$/g, '')
      .replace(/\s+([.。,，;；:：])/g, '$1')
      .replace(/[.。,，;；:：、]+$/g, '')
      .replace(/^[《【“"']+|[》】”"']+$/g, '')
      .trim();

    if (!text || /^(?:n\/a|none|null|未知|中国知网|CNKI|知网)$/i.test(text)) {
      return '';
    }

    return text;
  }

  /**
   * 判断当前页面是否是知网。
   *
   * @returns {boolean}
   */
  function isCnkiPage() {
    return CNKI_HOST_RE.test(location.hostname);
  }

  /**
   * 判断当前页面是否是知网的文章详情页。
   *
   * @returns {boolean}
   */
  function isCnkiArticlePage() {
    if (!isCnkiPage()) {
      return false;
    }

    if (
      /\/kcms2\/article\/abstract/i.test(location.pathname) ||
      /\/kcms\/detail\/detail\.aspx/i.test(location.pathname)
    ) {
      return true;
    }

    return Boolean(document.querySelector('#authorpart, .wx-tit, .brief h1'));
  }

  /**
   * 去掉 URL 中的跟踪参数和锚点。
   *
   * @param {string} rawUrl
   * @returns {string}
   */
  function stripTrackingParams(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);

      for (const key of Array.from(url.searchParams.keys())) {
        const lower = key.toLowerCase();
        if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
          url.searchParams.delete(key);
        }
      }

      for (const [key, value] of Array.from(url.searchParams.entries())) {
        if (!value) {
          url.searchParams.delete(key);
        }
      }

      url.hash = '';
      return url.href;
    } catch (error) {
      return rawUrl;
    }
  }

  /**
   * 尝试用知网的 dbcode/dbname/filename 构造稳定详情页链接。
   *
   * 知网新版的 v=... 参数很长，但有时是访问文章所必需的。能拿到 filename
   * 时优先使用旧版 detail.aspx 链接，它更短也更稳定。
   *
   * @returns {string}
   */
  function buildCnkiStableUrl() {
    const current = new URL(location.href);
    let dbcode = current.searchParams.get('dbcode') || '';
    let dbname = current.searchParams.get('dbname') || '';
    let filename = current.searchParams.get('filename') || '';

    if (!filename) {
      const input = document.querySelector(
        'input[name="filename" i], input#filename'
      );

      if (input && typeof input.value === 'string') {
        filename = input.value.trim();
      }
    }

    if (!filename) {
      for (const link of document.querySelectorAll('a[href*="filename=" i]')) {
        try {
          const url = new URL(link.href, location.href);
          const value = url.searchParams.get('filename');

          if (value) {
            filename = value;
            dbcode = dbcode || url.searchParams.get('dbcode') || '';
            dbname = dbname || url.searchParams.get('dbname') || '';
            break;
          }
        } catch (error) {
          // 忽略无法解析的链接。
        }
      }
    }

    if (!filename) {
      const pdfUrl = getFirstMeta(['citation_pdf_url']);

      if (pdfUrl) {
        try {
          const url = new URL(pdfUrl, location.href);
          filename = url.searchParams.get('filename') || '';
          dbcode = dbcode || url.searchParams.get('dbcode') || '';
          dbname = dbname || url.searchParams.get('dbname') || '';
        } catch (error) {
          // 忽略无法解析的链接。
        }
      }
    }

    if (!filename) {
      return '';
    }

    const stable = new URL('https://kns.cnki.net/kcms/detail/detail.aspx');
    if (dbcode) {
      stable.searchParams.set('dbcode', dbcode);
    }
    if (dbname) {
      stable.searchParams.set('dbname', dbname);
    }
    stable.searchParams.set('filename', filename);

    return stable.href;
  }

  /**
   * 获取干净、可用于引用的链接。
   *
   * @param {{ doi: string, isCnki: boolean }} options
   * @returns {string}
   */
  function getCleanUrl({ doi, isCnki }) {
    let canonicalUrl = '';
    const canonicalElement = document.querySelector(
      'link[rel~="canonical" i]'
    );

    if (canonicalElement) {
      const raw = canonicalElement.getAttribute('href');

      if (raw) {
        try {
          const resolved = new URL(raw, location.href);
          if (/^https?:/i.test(resolved.href)) {
            canonicalUrl = resolved.href;
          }
        } catch (error) {
          // 忽略无法解析的 canonical。
        }
      }
    }

    if (isCnki) {
      if (doi) {
        return `https://doi.org/${doi}`;
      }
      if (canonicalUrl) {
        return stripTrackingParams(canonicalUrl);
      }

      const stableUrl = buildCnkiStableUrl();
      if (stableUrl) {
        return stableUrl;
      }

      return stripTrackingParams(location.href);
    }

    if (canonicalUrl) {
      return stripTrackingParams(canonicalUrl);
    }
    if (doi) {
      return `https://doi.org/${doi}`;
    }

    return stripTrackingParams(location.href);
  }

  /**
   * 汇总当前页面的引用元数据。
   *
   * @returns {{
   *   title: string,
   *   authors: string[],
   *   journal: string,
   *   year: string,
   *   volume: string,
   *   issue: string,
   *   pages: string,
   *   doi: string,
   *   url: string,
   *   date: string,
   *   isCnki: boolean,
   *   isCnkiArticle: boolean
   * }}
   */
  function getPageMetadata() {
    const isCnki = isCnkiPage();
    const isCnkiArticle = isCnkiArticlePage();

    const title = extractTitle(isCnkiArticle);
    const authors = extractAuthors(isCnkiArticle);

    let journal = cleanJournal(
      getFirstMeta(['citation_journal_title'])
    );

    if (!journal) {
      journal = cleanJournal(
        getFirstMeta(['dc.source', 'dcterms.source']),
        true
      );
    }

    const publicationDate = getFirstMeta([
      'citation_publication_date',
      'citation_date',
      'dc.date',
      'dcterms.issued'
    ]);

    let volume = normalizeIssuePart(
      getFirstMeta(['citation_volume'])
    );
    let issue = normalizeIssuePart(
      getFirstMeta(['citation_issue'])
    );

    let pages = normalizePages(getFirstMeta(['citation_pages']));

    if (!pages) {
      const firstPage = cleanInlineText(
        getFirstMeta(['citation_firstpage'])
      );
      const lastPage = cleanInlineText(
        getFirstMeta(['citation_lastpage'])
      );

      if (firstPage) {
        pages = lastPage ? `${firstPage}-${lastPage}` : firstPage;
        pages = normalizePages(pages);
      }
    }

    // 知网页面上的期刊信息通常集中在 .top-tip / .article-info 中。
    const infoTexts = [];

    if (isCnkiArticle) {
      for (const selector of [
        '.top-tip',
        '.article-info',
        '.brief .source',
        '.journal-info',
        '.source-info'
      ]) {
        const element = document.querySelector(selector);

        if (element) {
          const text = cleanInlineText(element.textContent);
          if (text) {
            infoTexts.push(text);
          }
        }
      }
    }

    const infoText = dedupe(infoTexts).join(' ');

    if (!journal) {
      for (const selector of [
        '.journal-name',
        '.journal-title',
        '#journalName',
        '.brief .journal',
        '.source-title'
      ]) {
        const element = document.querySelector(selector);

        if (element) {
          const text = cleanJournal(element.textContent);
          if (text) {
            journal = text;
            break;
          }
        }
      }
    }

    // .top-tip 中的第一个有效链接通常就是期刊名。
    if (!journal) {
      const topTip = document.querySelector('.top-tip');

      if (topTip) {
        for (const link of topTip.querySelectorAll('a')) {
          const text = cleanJournal(link.textContent, true);

          if (
            text &&
            !/^(?:19|20)\d{2}\s*年|^\d{1,3}\s*期/.test(text) &&
            !/^(?:首页|期刊导航|中国知网|CNKI|知网|网络首发|优先出版|增强出版|更多|PDF|HTML|下载|全文|引用|收藏)$/i.test(
              text
            )
          ) {
            journal = text;
            break;
          }
        }
      }
    }

    if (!journal && infoText) {
      const quoted = infoText.match(/《([^》]{2,80})》/);

      if (quoted) {
        journal = cleanJournal(quoted[1]);
      } else {
        const beforeYear = infoText.split(
          /\s*(?:19|20)\d{2}\s*年|\s*(?:19|20)\d{2}\s*[,，]/
        )[0];

        journal = cleanJournal(beforeYear, true);
      }
    }

    let year = '';

    // 知网 .top-tip 中的“2023年”通常就是期刊出版年，优先使用。
    if (isCnkiArticle && infoText) {
      const issueYear = infoText.match(/(?:19|20)\d{2}\s*年/);
      if (issueYear) {
        year = issueYear[0].match(/\d{4}/)[0];
      }
    }

    if (!year) {
      year = extractYear(publicationDate);
    }
    if (!year && infoText) {
      year = extractYear(infoText);
    }

    if (!volume && infoText) {
      const match = infoText.match(/第?\s*(\d{1,3})\s*卷/);
      if (match) {
        volume = normalizeIssuePart(match[1]);
      }
    }

    if (!issue && infoText) {
      const match = infoText.match(/第?\s*(\d{1,3})\s*期/);
      if (match) {
        issue = normalizeIssuePart(match[1]);
      }
    }

    if ((!volume || !issue) && infoText) {
      const match = infoText.match(
        /\b(?:19|20)\d{2}\s*[,，]\s*(\d{1,3})\s*\(\s*(\d{1,3})\s*\)/
      );

      if (match) {
        if (!volume) {
          volume = normalizeIssuePart(match[1]);
        }
        if (!issue) {
          issue = normalizeIssuePart(match[2]);
        }
      }
    }

    if (!pages && infoText) {
      const match =
        infoText.match(
          /(?:页码|页)\s*[:：]?\s*(\d+)\s*[-–—~]\s*(\d+)/
        ) ||
        infoText.match(/[:：]\s*(\d+)\s*[-–—~]\s*(\d+)/);

      if (match) {
        pages = `${match[1]}-${match[2]}`;
      }
    }

    let doi = '';

    for (const value of getMetaValues([
      'citation_doi',
      'dc.identifier',
      'dcterms.identifier',
      'doi'
    ])) {
      doi = extractDoi(value);
      if (doi) {
        break;
      }
    }

    if (!doi && infoText) {
      doi = extractDoi(infoText);
    }

    if (!doi) {
      for (const element of document.querySelectorAll(
        '.doi, [class*="doi" i], a[href*="doi.org/"]'
      )) {
        const text = cleanInlineText(
          element.textContent || element.getAttribute('href') || ''
        );

        if (text.length <= 300) {
          doi =
            extractDoi(text) ||
            extractDoi(element.getAttribute('href') || '');

          if (doi) {
            break;
          }
        }
      }
    }

    return {
      title,
      authors,
      journal,
      year,
      volume,
      issue,
      pages,
      doi,
      url: getCleanUrl({ doi, isCnki }),
      date: normalizeDate(publicationDate),
      isCnki,
      isCnkiArticle
    };
  }

  // ---------------------------------------------------------------------------
  // GB/T 7714-2015 引用格式
  // ---------------------------------------------------------------------------

  /**
   * 格式化作者列表。
   *
   * GB/T 7714-2015 规定：3 位以内作者全部著录；超过 3 位时只列前 3 位，
   * 其后加“等”（中文）或“et al.”（英文）。
   *
   * @param {string[]} authors
   * @returns {string}
   */
  function formatAuthors(authors) {
    const cleaned = dedupe(
      (authors || []).map(normalizeAuthorName).filter(Boolean)
    );

    if (cleaned.length === 0) {
      return '';
    }

    const hasChinese = cleaned.some((name) => CJK_RE.test(name));

    if (cleaned.length > MAX_LISTED_AUTHORS) {
      return `${cleaned
        .slice(0, MAX_LISTED_AUTHORS)
        .join(', ')}, ${hasChinese ? '等' : 'et al.'}`;
    }

    return cleaned.join(', ');
  }

  /**
   * 格式化期刊、年、卷、期、页码。
   *
   * @param {{ journal: string, year: string, volume: string, issue: string, pages: string }} meta
   * @returns {string}
   */
  function formatSource(meta) {
    const journal = cleanInlineText(meta.journal)
      .replace(/^[《【“"']+|[》】”"']+$/g, '')
      .replace(/\s+([.。,，;；:：])/g, '$1')
      .replace(/[.。,，;；:：、]+$/g, '')
      .replace(/^[《【“"']+|[》】”"']+$/g, '')
      .trim();

    if (!journal) {
      return '';
    }

    let tail = '';

    if (meta.year) {
      tail += meta.year;
    }
    if (meta.volume) {
      tail += (tail ? ', ' : '') + meta.volume;
    }
    if (meta.issue) {
      tail += tail ? `(${meta.issue})` : meta.issue;
    }
    if (meta.pages) {
      tail += `: ${meta.pages}`;
    }

    return tail ? `${journal}, ${tail}` : journal;
  }

  /**
   * 清理引用中的题名：去掉末尾徽标、多余空格和句末标点。
   *
   * @param {unknown} value
   * @returns {string}
   */
  function cleanCitationTitle(value) {
    return cleanInlineText(value)
      .replace(TITLE_BADGE_RE, '')
      .replace(/\s+([.。;；])/g, '$1')
      .replace(/[.。;；]+$/, '')
      .trim();
  }

  /**
   * 构造纯文本引用。
   *
   * @param {ReturnType<typeof getPageMetadata>} meta
   * @returns {string}
   */
  function buildCitation(meta) {
    const authorText = formatAuthors(meta.authors);
    const authorPart = authorText
      ? `${authorText}${/[.。]$/.test(authorText) ? '' : '.'}`
      : '';
    const title = cleanCitationTitle(meta.title || UNKNOWN_TITLE);
    const segments = [];

    if (authorPart) {
      segments.push(authorPart);
    }

    if (meta.journal) {
      segments.push(`${title}[J].`);

      const source = formatSource(meta);
      if (source) {
        segments.push(`${source}.`);
      }

      if (meta.doi) {
        segments.push(`DOI: ${meta.doi}.`);
      } else if (meta.url) {
        segments.push(`${meta.url}.`);
      }
    } else {
      segments.push(`${title}[EB/OL].`);

      const issued = meta.date ? `(${meta.date})` : '';
      segments.push(`${issued}[${todayString()}].`);

      if (meta.url) {
        segments.push(`${meta.url}.`);
      }
    }

    return segments.join(' ');
  }

  /**
   * 构造富文本引用。
   *
   * 只把标题做成超链接，不再复制可见的 DOI/URL 链接文本。粘贴到
   * Word / WPS 后，标题就是唯一可点击的锚文本；纯文本版本仍保留
   * DOI 或干净 URL，便于不支持富文本的场景使用。
   *
   * @param {ReturnType<typeof getPageMetadata>} meta
   * @returns {string}
   */
  function buildCitationHtml(meta) {
    const authorText = formatAuthors(meta.authors);
    const authorPart = authorText
      ? `${escapeHtml(authorText)}${
          /[.。]$/.test(authorText) ? '' : '.'
        }`
      : '';
    const title = cleanCitationTitle(meta.title || UNKNOWN_TITLE);
    const safeTitle = escapeHtml(title);

    // 只保留一个最简单的 <a href>，兼容 Word / WPS 的超链接粘贴；
    // 字体属性使用 inherit，让标题跟随目标段落的字体和字号。
    const titleHtml = meta.url
      ? `<a href="${escapeHtml(
          meta.url
        )}" style="${INHERIT_FONT_STYLE}">${safeTitle}</a>`
      : safeTitle;

    const segments = [];

    if (authorPart) {
      segments.push(authorPart);
    }

    if (meta.journal) {
      segments.push(`${titleHtml}[J].`);

      const source = formatSource(meta);
      if (source) {
        segments.push(`${escapeHtml(source)}.`);
      }

      // DOI 作为普通文本保留；链接只放在标题上。
      if (meta.doi) {
        segments.push(`DOI: ${escapeHtml(meta.doi)}.`);
      }
    } else {
      segments.push(`${titleHtml}[EB/OL].`);

      const issued = meta.date ? `(${escapeHtml(meta.date)})` : '';
      segments.push(`${issued}[${todayString()}].`);
    }

    return segments.join(' ');
  }

  // ---------------------------------------------------------------------------
  // 复制事件
  // ---------------------------------------------------------------------------

  /**
   * 获取用户此次复制所对应的纯文本。
   *
   * 大多数场景下可以直接读取 window.getSelection()；但输入框和文本域中的
   * 选中内容不会出现在 window.getSelection() 里，所以需要单独处理。
   * 最后再尝试从 copy 事件的 clipboardData 中读取，作为兜底。
   *
   * @param {ClipboardEvent} event copy 事件对象
   * @returns {string} 用户选中的原始文本
   */
  function getSelectedText(event) {
    // 场景一：在 <input> 或 <textarea> 中选中文本。
    const activeElement = document.activeElement;

    if (
      activeElement &&
      (activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement)
    ) {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;

      if (
        typeof start === 'number' &&
        typeof end === 'number' &&
        end > start
      ) {
        return activeElement.value.slice(start, end);
      }
    }

    // 场景二：普通网页区域中的选区。
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return selection.toString();
    }

    // 场景三：兜底读取 copy 事件中的数据存储。
    if (event.clipboardData) {
      return event.clipboardData.getData('text/plain');
    }

    return '';
  }

  /**
   * 异步写入剪贴板的纯文本兜底方案。
   *
   * @param {string} text
   */
  function writePlainTextFallback(text) {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      navigator.clipboard.writeText(text).catch((error) => {
        console.error(
          '[学术引用复制助手] 使用 navigator.clipboard.writeText 写入剪贴板失败：',
          error
        );
      });
      return;
    }

    console.error('[学术引用复制助手] 当前浏览器环境不支持写入剪贴板。');
  }

  /**
   * 异步写入富文本剪贴板的兜底方案。
   *
   * @param {string} plainText
   * @param {string} htmlText
   */
  function writeClipboardFallback(plainText, htmlText) {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      typeof ClipboardItem !== 'undefined'
    ) {
      try {
        const item = new ClipboardItem({
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
          'text/html': new Blob([htmlText], { type: 'text/html' })
        });

        navigator.clipboard.write([item]).catch((error) => {
          console.error(
            '[学术引用复制助手] 使用 navigator.clipboard.write 写入富文本失败，将回退为纯文本：',
            error
          );
          writePlainTextFallback(plainText);
        });
        return;
      } catch (error) {
        console.error(
          '[学术引用复制助手] 构造富文本剪贴板内容失败，将回退为纯文本：',
          error
        );
      }
    }

    writePlainTextFallback(plainText);
  }

  /**
   * 处理 copy 事件。
   *
   * @param {ClipboardEvent} event
   */
  function handleCopy(event) {
    // 页面通过 execCommand('copy') 等程序化方式复制时不要干预，
    // 以免给页面自己的“复制引用”按钮追加重复内容。
    if (event.isTrusted === false) {
      return;
    }

    const originalText = getSelectedText(event);

    // 没有选中文本时不干预复制（例如复制图片），以免破坏网页原有功能。
    if (!originalText) {
      return;
    }

    const isCnki = isCnkiPage();
    const cleanedOriginal = normalizeCopiedText(originalText, isCnki);

    // 如果清理后没有有效文本，也不干预复制。
    if (!cleanedOriginal) {
      return;
    }

    let meta;
    let citationText;
    let citationHtml;

    try {
      meta = getPageMetadata();
      citationText = buildCitation(meta);
      citationHtml = buildCitationHtml(meta);
    } catch (error) {
      // 元数据提取失败时不接管复制，保留浏览器默认行为。
      console.error(
        '[学术引用复制助手] 提取引用元数据失败，已跳过本次处理：',
        error
      );
      return;
    }

    const plainText = `${cleanedOriginal}\n\n${citationText}`;
    const originalHtml = escapeHtml(cleanedOriginal).replace(/\n/g, '<br>');

    // 用内联 <span> 和 <br>，避免 <div> 在 Word 中另起段落并套用默认样式。
    // inherit 样式让粘贴内容跟随光标所在段落的字体、字号和行高。
    const htmlText = `<meta charset="utf-8"><span style="${INHERIT_FONT_STYLE}">${originalHtml}<br><br>${citationHtml}</span>`;

    // 接管复制行为，防止浏览器用未修改的选区覆盖剪贴板内容。
    event.preventDefault();

    // 首选方案：同步写入 copy 事件自带的 clipboardData。
    if (event.clipboardData) {
      try {
        event.clipboardData.setData('text/plain', plainText);
        event.clipboardData.setData('text/html', htmlText);
        return;
      } catch (error) {
        console.error(
          '[学术引用复制助手] 使用 clipboardData.setData 写入剪贴板失败，将尝试备用方案：',
          error
        );
      }
    }

    // 备用方案：异步写入系统剪贴板。
    writeClipboardFallback(plainText, htmlText);
  }

  // 使用 window 的捕获阶段监听，尽可能早于页面自身的 copy 处理器执行。
  window.addEventListener('copy', handleCopy, true);
})();
