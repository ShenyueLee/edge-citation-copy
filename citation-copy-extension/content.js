/**
 * 学术引用复制助手 - 内容脚本
 *
 * 工作流程：
 * 1. 监听页面上的 copy 事件（包括 Ctrl+C 和右键菜单中的“复制”）；
 * 2. 读取用户选中的文本以及当前页面的标题、URL、作者元数据；
 * 3. 阻止浏览器默认的复制行为，改用修改后的文本写入剪贴板。
 *
 * 注意：优先使用同步的 e.clipboardData.setData()，因为它不会受到
 * 异步权限检查的影响，兼容性更好；仅在它不可用或写入失败时，
 * 才回退到异步的 navigator.clipboard.writeText()。
 */
(() => {
  'use strict';

  // 页面没有提供作者信息时使用的占位文本。
  const UNKNOWN_AUTHOR = '未知作者';

  /**
   * 获取当前页面的引用元数据。
   *
   * 作者信息来自页面中的 <meta name="citation_author" content="...">。
   * 学术站点通常会通过重复这个标签来列出多位作者，因此这里会读取全部
   * 匹配项并用中文顿号拼接。若一个都没有，则返回“未知作者”。
   *
   * @returns {{ title: string, url: string, author: string }}
   */
  function getPageMetadata() {
    const title = document.title.trim() || '未知标题';
    const url = window.location.href;

    // 使用 [i] 让属性名匹配不区分大小写，兼容写成 Citation_Author 的页面。
    const authorNodes = document.querySelectorAll('meta[name="citation_author" i]');

    const authors = Array.from(authorNodes)
      .map((node) => node.getAttribute('content'))
      .map((content) => (content ? content.trim() : ''))
      .filter((content) => content.length > 0);

    return {
      title,
      url,
      author: authors.length > 0 ? authors.join('、') : UNKNOWN_AUTHOR
    };
  }

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
   * 在原始文本末尾追加引用信息。
   *
   * @param {string} originalText 用户选中的原始文本
   * @returns {string} 追加引用信息后的文本
   */
  function buildCitationText(originalText) {
    const { title, url, author } = getPageMetadata();

    return `${originalText}\n\n[引用信息：${title} | 作者：${author} | 链接：${url}]`;
  }

  /**
   * 处理 copy 事件。
   *
   * @param {ClipboardEvent} event
   */
  function handleCopy(event) {
    const originalText = getSelectedText(event);

    // 没有选中文本时不干预复制（例如复制图片），以免破坏网页原有功能。
    if (!originalText) {
      return;
    }

    const modifiedText = buildCitationText(originalText);

    // 接管复制行为，防止浏览器用未修改的选区覆盖剪贴板内容。
    event.preventDefault();

    // 首选方案：同步写入 copy 事件自带的 clipboardData。
    if (event.clipboardData) {
      try {
        event.clipboardData.setData('text/plain', modifiedText);
        return;
      } catch (error) {
        console.error(
          '[学术引用复制助手] 使用 clipboardData.setData 写入剪贴板失败，将尝试备用方案：',
          error
        );
      }
    }

    // 备用方案：异步写入系统剪贴板。
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(modifiedText).catch((error) => {
        console.error(
          '[学术引用复制助手] 使用 navigator.clipboard.writeText 写入剪贴板失败：',
          error
        );
      });
      return;
    }

    console.error('[学术引用复制助手] 当前浏览器环境不支持写入剪贴板。');
  }

  // 使用捕获阶段监听，尽可能早于页面自身的 copy 处理器执行。
  document.addEventListener('copy', handleCopy, true);
})();
