export function openPendingTab() {
  const tab = window.open('', '_blank');
  if (tab) {
    tab.document.title = 'Preparing document...';
    tab.document.body.style.cssText = 'font-family:sans-serif;padding:2rem;color:#3b2a1f';
    tab.document.body.textContent = 'Preparing your document...';
  }
  return tab;
}

export function showPdfInTab(tab, url, fallbackContainer, label = 'Open PDF') {
  if (tab && !tab.closed) {
    tab.location.href = url;
    return true;
  }
  if (fallbackContainer) {
    fallbackContainer.textContent = '';
    const note = document.createElement('span');
    note.textContent = 'Your browser blocked the new tab. ';
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = label;
    fallbackContainer.append(note, link);
  }
  return false;
}

export function closePendingTab(tab) {
  if (tab && !tab.closed) tab.close();
}
