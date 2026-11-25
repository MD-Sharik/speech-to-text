let ws = null
let ctx = null
let mic = null

const startBtn = document.getElementById('startBtn')
const stopBtn = document.getElementById('stopBtn')
const saveBtn = document.getElementById('saveBtn')
const copyBtn = document.getElementById('copyBtn')
const clearBtn = document.getElementById('clearBtn')
const statusTxt = document.getElementById('status')
const liveTxt = document.getElementById('liveTxt')
const wordCount = document.getElementById('wordCount')
const search = document.getElementById('search')
const list = document.getElementById('list')

function setStatus(msg, type = '') {
  statusTxt.textContent = msg
  statusTxt.className = type
}

function updateCount() {
  let t = liveTxt.value.trim()
  let n = t ? t.split(/\s+/).length : 0
  wordCount.textContent = n + (n == 1 ? ' word' : ' words')
}

function stopMic() {
  if (mic) mic.getTracks().forEach((t) => t.stop())
  if (ctx) ctx.close()
  mic = null
  ctx = null
}

function resetButtons() {
  startBtn.disabled = false
  stopBtn.disabled = true
}

startBtn.onclick = async () => {
  startBtn.disabled = true
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    resetButtons()
    setStatus('mic not available: ' + e.message, 'error')
    return
  }

  setStatus('connecting...')
  stopBtn.disabled = false

  let sock = new WebSocket((location.protocol == 'https:' ? 'wss://' : 'ws://') + location.host + '/live')
  let ready = false
  let failed = false
  ws = sock
  sock.binaryType = 'arraybuffer'

  sock.onmessage = (e) => {
    let d = JSON.parse(e.data)
    if (d.type == 'text') {
      liveTxt.value += d.text
      liveTxt.scrollTop = liveTxt.scrollHeight
      updateCount()
    }
    if (d.type == 'error') {
      failed = true
      setStatus('error: ' + d.msg, 'error')
    }
    if (d.type == 'ready' && ws == sock) {
      ready = true
      setStatus('listening...', 'live')
    }
  }

  sock.onclose = () => {
    if (ws != sock) return
    ws = null
    stopMic()
    resetButtons()
    if (!failed) setStatus('connection lost, press Start to continue', 'error')
  }

  try {
    let audio = new AudioContext()
    ctx = audio
    await audio.audioWorklet.addModule('worklet.js')
    if (ws != sock) return
    let src = audio.createMediaStreamSource(mic)
    let node = new AudioWorkletNode(audio, 'rec')
    node.port.onmessage = (e) => {
      if (ready && sock.readyState == 1) sock.send(e.data)
    }
    src.connect(node)
    node.connect(audio.destination)
  } catch (e) {
    if (ws != sock) return
    ws = null
    sock.close()
    stopMic()
    resetButtons()
    setStatus('audio error: ' + e.message, 'error')
  }
}

stopBtn.onclick = () => {
  let oldWs = ws
  ws = null
  if (oldWs && oldWs.readyState == 1) oldWs.send(JSON.stringify({ type: 'stop' }))
  stopMic()
  setTimeout(() => {
    if (oldWs) oldWs.close()
  }, 2000)
  resetButtons()
  setStatus('stopped')
}

async function api(url, method = 'GET', body) {
  let res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  let data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'request failed')
  return data
}

saveBtn.onclick = async () => {
  let t = liveTxt.value.trim()
  if (!t) return alert('Nothing to save')
  saveBtn.disabled = true
  try {
    await api('/api/transcripts', 'POST', { text: t })
    liveTxt.value = ''
    updateCount()
    search.value = ''
    await loadList()
  } catch (e) {
    alert('Save failed: ' + e.message)
  }
  saveBtn.disabled = false
}

async function copyText(text, btn) {
  if (!text) return
  let old = btn.textContent
  try {
    await navigator.clipboard.writeText(text)
    btn.textContent = 'Copied'
  } catch (e) {
    btn.textContent = 'Failed'
  }
  setTimeout(() => (btn.textContent = old), 1200)
}

copyBtn.onclick = () => copyText(liveTxt.value.trim(), copyBtn)

clearBtn.onclick = () => {
  liveTxt.value = ''
  updateCount()
}

liveTxt.oninput = updateCount

let timer = null
search.oninput = () => {
  clearTimeout(timer)
  timer = setTimeout(loadList, 300)
}

function mkBtn(name, cls = '') {
  let b = document.createElement('button')
  b.textContent = name
  b.className = cls
  return b
}

function showMessage(msg) {
  list.innerHTML = ''
  let tr = document.createElement('tr')
  let td = document.createElement('td')
  td.colSpan = 4
  td.className = 'empty'
  td.textContent = msg
  tr.appendChild(td)
  list.appendChild(tr)
}

function speak(text) {
  speechSynthesis.cancel()
  let u = new SpeechSynthesisUtterance(text)
  u.lang = /[ऀ-ॿ]/.test(text) ? 'hi-IN' : 'en-IN'
  speechSynthesis.speak(u)
}

function makeRow(item) {
  let tr = document.createElement('tr')
  let td1 = document.createElement('td')
  let td2 = document.createElement('td')
  let td3 = document.createElement('td')
  let td4 = document.createElement('td')
  td1.textContent = item.id
  td2.textContent = item.text
  td2.className = 'text'
  td3.textContent = new Date(item.created_at).toLocaleString()
  td3.className = 'date'
  td4.className = 'actions'

  let editBtn = mkBtn('Edit')
  let cancelBtn = mkBtn('Cancel')
  let delBtn = mkBtn('Delete', 'danger')
  let speakBtn = mkBtn('Speak')
  let rowCopyBtn = mkBtn('Copy')
  cancelBtn.hidden = true

  editBtn.onclick = async () => {
    if (editBtn.textContent == 'Edit') {
      let box = document.createElement('textarea')
      box.value = item.text
      td2.innerHTML = ''
      td2.appendChild(box)
      box.focus()
      editBtn.textContent = 'Update'
      cancelBtn.hidden = false
      return
    }
    let val = td2.querySelector('textarea').value.trim()
    if (!val) return alert('Text cant be empty')
    try {
      await api('/api/transcripts/' + item.id, 'PUT', { text: val })
      loadList()
    } catch (e) {
      alert('Update failed: ' + e.message)
    }
  }

  cancelBtn.onclick = () => {
    td2.textContent = item.text
    editBtn.textContent = 'Edit'
    cancelBtn.hidden = true
  }

  delBtn.onclick = async () => {
    if (!confirm('Delete this?')) return
    try {
      await api('/api/transcripts/' + item.id, 'DELETE')
      loadList()
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  speakBtn.onclick = () => speak(item.text)
  rowCopyBtn.onclick = () => copyText(item.text, rowCopyBtn)

  td4.append(editBtn, cancelBtn, speakBtn, rowCopyBtn, delBtn)
  tr.append(td1, td2, td3, td4)
  return tr
}

let lastReq = 0
async function loadList() {
  let reqNo = ++lastReq
  try {
    let arr = await api('/api/transcripts?q=' + encodeURIComponent(search.value))
    if (reqNo != lastReq) return
    if (arr.length == 0) return showMessage(search.value ? 'No matching records' : 'No records yet')
    list.innerHTML = ''
    arr.forEach((item) => list.appendChild(makeRow(item)))
  } catch (e) {
    if (reqNo == lastReq) showMessage('Could not load history')
  }
}

updateCount()
loadList()
