/**
 * One-click hand-off to the Unity editor.
 *
 * MapForge posts the current document to the local backend, which writes a revision
 * into the Unity project's MapForgeSync folder; the Unity editor plug-in applies it
 * and answers with a result file. This module owns the transport, while app.js owns
 * the dialog lifecycle, exactly like the Unity component mapping dialog.
 */

const jsonHeaders = { 'Content-Type': 'application/json' };

async function readJson(response) {
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.error ?? body?.message ?? `请求失败（HTTP ${response.status}）。`);
  return body;
}

/** Connection state and the last applied revision reported by the Unity editor. */
export async function fetchSyncStatus() {
  return readJson(await fetch('/api/unity/status'));
}

/** Change set MapForge would send right now; writes nothing. */
export async function fetchSyncPreview(map) {
  return readJson(await fetch('/api/unity/preview', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(map) }));
}

/** Writes the next revision for the Unity editor to pick up. */
export async function sendMapToUnity(map, mode = 'increment') {
  return readJson(await fetch('/api/unity/send', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ map, mode }) }));
}

/** Points the backend at a specific Unity project, or clears the setting when path is empty. */
export async function setUnityTarget(path) {
  return readJson(await fetch('/api/unity/target', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ unityProject: path }) }));
}

/** Drops the diff baseline so the next send rebuilds the scene from scratch. */
export async function resetSyncBaseline() {
  return readJson(await fetch('/api/unity/reset', { method: 'POST', headers: jsonHeaders }));
}

const modeLabels = { increment: '增量更新', full: '完整重建' };

function list(names, escape) {
  if (!names?.length) return '<span class="sync-empty">无</span>';
  return names.map(name => `<code>${escape(name)}</code>`).join(' ');
}

function resultHtml(result, escape) {
  if (!result) return '<div class="sync-empty">尚未收到 Unity 的同步结果。</div>';
  const lines = Array.isArray(result.log) ? result.log : [];
  return `<div class="sync-result ${result.ok ? 'ok' : 'bad'}">
    <div class="sync-result-head">${result.ok ? '✓ 已应用' : '✗ 未应用'} · 第 ${escape(String(result.revision ?? '?'))} 版 · ${escape(result.sceneName ?? '未知场景')}</div>
    <div class="sync-meta">${escape(result.appliedAtUtc ?? '')} · ${escape(String(result.durationMs ?? 0))} ms · 新建 ${escape(String(result.created ?? 0))} / 修改 ${escape(String(result.updated ?? 0))} / 删除 ${escape(String(result.deleted ?? 0))}</div>
    ${result.message ? `<div class="sync-message">${escape(result.message)}</div>` : ''}
    ${lines.length ? `<ul class="sync-log">${lines.slice(-8).map(line => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

/** Body of the send-to-Unity dialog. */
export function unitySyncHtml(state, ui) {
  const { escape } = ui;
  const status = state.status ?? {};
  const preview = state.preview ?? {};
  // The field keeps whatever the user typed while polling redraws the rest of the panel, so a
  // rejected path can be corrected instead of being thrown away. The status line above reports
  // the project the backend actually uses, which is what a send will go to.
  const target = state.targetDraft || status.unityProject || preview.unityProject || '';
  const active = status.unityProject || preview.unityProject || '';
  const connection = status.connected
    ? `<span class="sync-dot on"></span> Unity 编辑器在线${status.appliedScene ? ` · 当前场景 ${escape(status.appliedScene)}` : ''}`
    : `<span class="sync-dot off"></span> Unity 编辑器离线`;
  return `
  <div class="sync-panel">
    <div class="dialog-head"><h2>一键发送到 Unity</h2><button class="btn" data-close>关闭 · Esc</button></div>
    <div class="section">
      <div class="sync-connection">${connection}</div>
      <div class="sync-meta">当前目标：${escape(active || '未找到 Unity 工程')}</div>
      ${status.connected ? '' : `<div class="sync-hint">${escape(status.hint ?? '请打开 Unity 工程并保持编辑器运行，插件每 15 秒写入一次心跳。')}</div>`}
      <div class="field"><label>Unity 工程路径</label><input id="syncTarget" value="${escape(target)}" placeholder="C:\\Unity Project\\ProjectAlphaOperationStriker"></div>
      <div class="sync-actions">
        <button class="btn" data-action="status">刷新状态</button>
        <button class="btn" data-action="target">应用工程路径</button>
        <button class="btn" data-action="reset">清除基线（下次重建）</button>
      </div>
    </div>
    <div class="section">
      <div class="eyebrow">Change set / 变更预览</div>
      <div class="sync-mode">${escape(modeLabels[preview.mode] ?? '—')}${preview.rebuildReason ? ` · ${escape(preview.rebuildReason)}` : ''}</div>
      <div class="sync-counts">
        <span>对象 ${escape(String(preview.objects ?? 0))}</span><span>新建 ${escape(String(preview.created ?? 0))}</span>
        <span>修改 ${escape(String(preview.updated ?? 0))}</span><span>删除 ${escape(String(preview.deleted ?? 0))}</span>
        ${preview.unityChanged ? '<span class="sync-warn">Unity 组件映射有变化</span>' : ''}
      </div>
      <div class="sync-list"><b>新建</b>${list(preview.changes?.created, escape)}</div>
      <div class="sync-list"><b>修改</b>${list(preview.changes?.updated, escape)}</div>
      <div class="sync-list"><b>删除</b>${list(preview.changes?.deleted, escape)}</div>
      <div class="sync-hint">增量发送只重建列出的对象，不动其他内容；完整重建也会保留项目手工添加的对象（放在 MapForgeWorld 之外最稳妥）。如果目标场景里的对象没有 MapForge 标识，本次会自动改为完整重建一次，之后即可增量。</div>
    </div>
    <div class="section">
      <div class="eyebrow">Result / Unity 回执</div>
      ${resultHtml(status.lastResult, escape)}
    </div>
    <div class="sync-actions footer">
      <button class="btn primary" data-action="send" ${state.busy ? 'disabled' : ''}>${state.busy ? '发送中…' : '⚡ 发送到 Unity'}</button>
      <button class="btn" data-action="send-full" ${state.busy ? 'disabled' : ''}>完整重建</button>
    </div>
  </div>`;
}

/** Wires the dialog buttons; the handlers come from app.js so undo/notice stay in one place. */
export function wireUnitySync(root, handlers) {
  root.querySelector('[data-close]')?.addEventListener('click', handlers.close);
  const field = root.querySelector('#syncTarget');
  // Reported on every keystroke so a status poll cannot reset a half-typed path.
  field?.addEventListener('input', () => handlers.draft?.(field.value));

  for (const button of root.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'send' || action === 'send-full') handlers.send(action === 'send-full' ? 'full' : 'increment');
      else if (action === 'status') handlers.refresh();
      else if (action === 'target') handlers.target(root.querySelector('#syncTarget')?.value ?? '');
      else if (action === 'reset') handlers.reset();
    });
  }
}