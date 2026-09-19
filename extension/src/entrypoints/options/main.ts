// Force TypeScript to treat this file as a module (it has no other
// import/export) so top-level declarations don't merge into the global
// scope, where `status` would collide with the ambient `Window.status`.
export {}

const input = document.querySelector<HTMLInputElement>('#key')!
const button = document.querySelector<HTMLButtonElement>('#save')!
const status = document.querySelector<HTMLDivElement>('#status')!

// storage.local, never storage.sync: secrets should not ride along to other
// machines on the user's Google account.
void chrome.storage.local.get('apiKey').then(({ apiKey }) => {
  if (typeof apiKey === 'string') input.value = apiKey
})

button.addEventListener('click', async () => {
  await chrome.storage.local.set({ apiKey: input.value.trim() })
  status.textContent = 'Đã lưu.'
  setTimeout(() => (status.textContent = ''), 2000)
})
