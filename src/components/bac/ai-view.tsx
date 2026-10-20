import { useEffect, useMemo, useState } from "react";
import { Menu, Plus, Trash2, X } from "lucide-react";
import type { AgentAction } from "@/lib/bac/actions";
import { validateActions } from "@/lib/bac/actions";
import { AiError } from "@/lib/bac/ai";
import { runAgent } from "@/lib/bac/prompts";
import { clearAiLesson, deleteChat, getSnapshot, newChat, pushThreadMessage, renameChat, replaceState, selectChat, setAssistantMemory, setTab, toast, useApp } from "@/lib/bac/store";
import { Btn } from "./ui";

const SUGGESTIONS = ["ماذا بقي علي اليوم؟", "ما المادة التي أهملتها؟", "أعد ترتيب بقية الأسبوع", "أنا متأخر في الفيزياء"];

export function AiView() {
  const { state, aiLessonId } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [pending, setPending] = useState<{ lines: string[]; actions: AgentAction[]; overrideConstraints?: boolean; warnings?: string[] } | null>(null);
  const active = state.chats.find((c) => c.id === state.activeChatId) ?? null;
  const lessonId = active?.lessonId ?? aiLessonId;
  const activeLesson = state.lessons.find((lesson) => lesson.id === lessonId) ?? null;
  const activeSubject = activeLesson ? state.subjects.find((subject) => subject.id === activeLesson.subjectId) : null;
  const chats = useMemo(() => [...state.chats].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), [state.chats]);

  useEffect(() => { if (!state.activeChatId) newChat(); }, [state.activeChatId]);

  async function send(message: string) {
    const content = message.trim(); if (!content || busy) return;
    let chatId = getSnapshot().state.activeChatId;
    if (!chatId) chatId = newChat(activeLesson?.id);
    setText(""); setBusy(true); pushThreadMessage(chatId, "user", content);
    try {
      const lessonContext = activeLesson ? `\n\n[سياق الدرس المحدد]\nالمادة: ${activeSubject?.name ?? "غير محددة"}\nالعنوان: ${activeLesson.title}\nالإتقان: ${activeLesson.mastery}%\nنقاط الضعف: ${activeLesson.weakPoints.join("، ") || "لا توجد"}\nنص الدرس:\n${activeLesson.body.slice(0,12000)}\n[نهاية الدرس]` : "";
      const current = getSnapshot().state;
      const thread = current.chats.find((c) => c.id === chatId);
      const history = (thread?.messages ?? []).slice(0,-1);
      const result = await runAgent(current, history, content + lessonContext);
      pushThreadMessage(chatId, "assistant", result.reply);
      if (result.memory !== current.assistantMemory.summary) setAssistantMemory(result.memory);
      if (result.actions.length) {
        const latest = getSnapshot().state;
        const check = validateActions(latest, result.actions);
        if (check.ok) setPending({ lines: check.lines, actions: result.actions });
        else {
          const forced = validateActions(latest, result.actions, undefined, { allowConstraintViolations: true });
          if (forced.ok) setPending({ lines: forced.lines, actions: result.actions, overrideConstraints: true, warnings: check.errors });
          else pushThreadMessage(chatId, "assistant", `تعذّر تجهيز الاقتراح للتطبيق:\n${forced.errors.join("\n")}`);
        }
      }
    } catch (error) { pushThreadMessage(chatId, "assistant", error instanceof AiError ? error.message : "تعذّر الوصول للمساعد. الوظائف المحلية ما زالت تعمل."); }
    finally { setBusy(false); }
  }

  function apply() {
    if (!pending) return;
    const check = validateActions(getSnapshot().state, pending.actions, undefined, pending.overrideConstraints ? { allowConstraintViolations: true } : undefined);
    if (!check.ok) { toast(check.errors[0] ?? "لم يعد التعديل صالحًا"); setPending(null); return; }
    replaceState(check.next); setPending(null); toast(pending.overrideConstraints ? "طُبّقت التغييرات رغم المخالفات" : "طُبّقت التغييرات"); if (check.next.focus) setTab("timer");
  }

  return <div className="chat-shell">
    {drawer && <button className="chat-backdrop" aria-label="إغلاق" onClick={() => setDrawer(false)} />}
    <aside className={`chat-drawer ${drawer ? "open" : ""}`}>
      <div className="spread"><strong>المحادثات</strong><button className="btn btn-ghost" onClick={() => setDrawer(false)}><X size={18}/></button></div>
      <Btn onClick={() => { newChat(); clearAiLesson(); setDrawer(false); }}><Plus size={17}/> محادثة جديدة</Btn>
      <div className="chat-history">{chats.map(c => <div key={c.id} className={`chat-history-item ${c.id===state.activeChatId ? "active" : ""}`}>
        <button onClick={() => { selectChat(c.id); setDrawer(false); }}>{c.title}<small>{new Date(c.updatedAt).toLocaleDateString("ar-DZ")}</small></button>
        <button aria-label="حذف" onClick={() => deleteChat(c.id)}><Trash2 size={15}/></button>
      </div>)}</div>
    </aside>

    <div className="chat-main">
      <header className="chat-head"><button className="btn btn-ghost" onClick={() => setDrawer(true)}><Menu size={20}/></button><div><strong>{active?.title ?? "محادثة جديدة"}</strong><small>ذاكرة الرفيق {state.assistantMemory.enabled ? "مفعّلة" : "متوقفة"}</small></div><button className="btn btn-ghost" onClick={() => { const id=newChat(); selectChat(id); clearAiLesson(); }}><Plus size={20}/></button></header>
      {activeLesson && <div className="lesson-context"><span>📘 {activeLesson.title} · {activeSubject?.name}</span><button onClick={clearAiLesson}>فك الربط</button></div>}
      <div className="chat-messages">
        {!active?.messages.length && <div className="chat-empty"><h1>بماذا نبدأ؟</h1><p className="muted">اسألني عن دراستك، جدولك أو درس من المكتبة.</p><div className="row">{SUGGESTIONS.map(x=><button className="chip" key={x} onClick={()=>void send(x)}>{x}</button>)}</div></div>}
        {active?.messages.map(m => <article key={m.id} className={`chat-bubble ${m.role}`}><p>{m.text}</p></article>)}
        {busy && <div className="chat-bubble assistant muted">يفكر…</div>}
        {pending && <section className="card stack proposal"><strong>التغييرات المقترحة</strong>{pending.warnings?.map(w=><p className="warn" key={w}>⚠️ {w}</p>)}{pending.lines.map(l=><p key={l}>{l}</p>)}<div className="row"><Btn onClick={apply}>{pending.overrideConstraints ? "تطبيق رغم المخالفات" : "تطبيق"}</Btn><Btn kind="ghost" onClick={()=>setPending(null)}>إلغاء</Btn></div></section>}
      </div>
      <div className="chat-composer"><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send(text)}}} placeholder={activeLesson ? `اسأل عن ${activeLesson.title}` : "اكتب رسالتك…"}/><button disabled={busy||!text.trim()} onClick={()=>void send(text)}>↑</button></div>
    </div>
  </div>;
}
