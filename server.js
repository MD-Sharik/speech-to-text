import 'dotenv/config'
import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import pg from 'pg'
import { GoogleGenAI, Modality } from '@google/genai'

const app = express()
app.use(express.json())
app.use(express.static('public'))

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL == 'true' ? { rejectUnauthorized: false } : false
})
db.on('error', (e) => console.log('db error:', e.message))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/live' })
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } })
const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-live-preview'

await db.query(`create table if not exists transcripts (
  id serial primary key,
  text text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)`)

function getText(req) {
  let t = req.body?.text
  return typeof t == 'string' ? t.trim() : ''
}

app.param('id', (req, res, next, id) => {
  if (!/^\d{1,9}$/.test(id)) return res.status(404).json({ error: 'not found' })
  next()
})

app.get('/api/transcripts', async (req, res) => {
  let q = String(req.query.q || '').replace(/[\\%_]/g, '\\$&')
  let r = await db.query('select * from transcripts where text ilike $1 order by id desc', ['%' + q + '%'])
  res.json(r.rows)
})

app.get('/api/transcripts/:id', async (req, res) => {
  let r = await db.query('select * from transcripts where id = $1', [req.params.id])
  if (r.rows.length == 0) return res.status(404).json({ error: 'not found' })
  res.json(r.rows[0])
})

app.post('/api/transcripts', async (req, res) => {
  let txt = getText(req)
  if (!txt) return res.status(400).json({ error: 'text is required' })
  let r = await db.query('insert into transcripts (text) values ($1) returning *', [txt])
  res.status(201).json(r.rows[0])
})

app.put('/api/transcripts/:id', async (req, res) => {
  let txt = getText(req)
  if (!txt) return res.status(400).json({ error: 'text is required' })
  let r = await db.query('update transcripts set text = $1, updated_at = now() where id = $2 returning *', [txt, req.params.id])
  if (r.rows.length == 0) return res.status(404).json({ error: 'not found' })
  res.json(r.rows[0])
})

app.delete('/api/transcripts/:id', async (req, res) => {
  let r = await db.query('delete from transcripts where id = $1', [req.params.id])
  if (r.rowCount == 0) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: 'bad request' })
  console.log(err)
  res.status(500).json({ error: 'something went wrong' })
})

wss.on('connection', (ws) => {
  let done = false
  let send = (obj) => {
    if (ws.readyState == 1) ws.send(JSON.stringify(obj))
  }
  let fail = (msg) => {
    console.log('live error:', msg)
    send({ type: 'error', msg })
    ws.close()
  }

  let sess = ai.live.connect({
    model: modelName,
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      systemInstruction: 'You are only a listener. The user may speak Hindi, English or a mix of both. Do not reply, stay silent.'
    },
    callbacks: {
      onmessage: (m) => {
        let t = m.serverContent?.inputTranscription?.text
        if (t) send({ type: 'text', text: t })
      },
      onerror: (e) => {
        if (!done) fail(e.message || 'gemini error')
      },
      onclose: (e) => {
        if (!done) fail('gemini closed the connection ' + (e.reason || ''))
      }
    }
  })

  sess.then(() => send({ type: 'ready' })).catch((e) => fail(e.message))

  ws.on('message', async (data, isBin) => {
    let s = await sess.catch(() => null)
    if (!s) return
    try {
      if (isBin) {
        s.sendRealtimeInput({ audio: { data: Buffer.from(data).toString('base64'), mimeType: 'audio/pcm;rate=16000' } })
      } else {
        let m = JSON.parse(data.toString())
        if (m.type == 'stop') s.sendRealtimeInput({ audioStreamEnd: true })
      }
    } catch (e) {
      console.log('bad message:', e.message)
    }
  })

  ws.on('close', async () => {
    done = true
    let s = await sess.catch(() => null)
    if (s) s.close()
  })
})

if (!process.env.VERCEL) {
  let port = process.env.PORT || 3000
  server.listen(port, () => console.log('running on http://localhost:' + port))
}

export default server
