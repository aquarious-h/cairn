import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { onValue, ref, set } from 'firebase/database';
import {
  useAskCareerCopilot, useConsultCareerCouncil, useGenerateCareerExperiment,
  useGenerateCareerRecommendations, useReflectOnWeeklyPulse, useResearchCareerMarketSignals,
  useSimulateCareerFutures,
} from '@workspace/api-client-react';
import type {
  CareerProfile, CareerPriorities, CareerPath, CareerExperiment, CareerSimulation,
  CareerCouncil, CareerPulse, CareerMarketSignals, CareerChatMessage,
} from '@workspace/api-client-react';
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check,
  CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Compass, Download, FlaskConical,
  Heart, Lightbulb, LockKeyhole, LogOut, MessageCircle, Moon, Plus,
  Search, Send, Settings2, ShieldCheck, Sparkles, Target, Trash2, TrendingUp,
  UsersRound, WandSparkles, X,
} from 'lucide-react';
import AuthScreen from '@/pages/auth-screen';
import { AuthProvider, useAuth } from '@/lib/auth-provider';
import { firebaseConfigured, firebaseDatabase } from '@/lib/firebase';
import './index.css';
import './cairn-overrides.css';

const queryClient = new QueryClient();
type Page = '/onboarding' | '/today' | '/paths' | '/lab' | '/plan' | '/simulator' | '/journal' | '/me';
type Priority = keyof CareerPriorities;
type ExperimentRecord = { id: string; careerTitle: string; plan: CareerExperiment; status: 'active'|'completed'|'paused'; step: number; energy?: number; reflection?: string; created: string };
type Milestone = { id: string; title: string; detail: string; deadline: string; status: 'next'|'doing'|'done'; proof: string };
type JournalRecord = { id: string; kind: string; title: string; text: string; date: string };
type Stored = {
  profile: CareerProfile; priorities: CareerPriorities; recommendations: CareerPath[];
  clarity: number|null; summary: string; savedPaths: string[]; hiddenPaths: string[];
  pathStatuses: Record<string, 'considering'|'exploring'|'paused'|'ruled-out'>; marketSignals: CareerMarketSignals|null;
  experiments: ExperimentRecord[]; milestones: Milestone[]; journal: JournalRecord[];
  pulse: { mood: number; progress: string; blocker: string; response?: CareerPulse }|null;
  settings: { excludeProfile: boolean; locale: string; theme: 'light'|'dark'; language: string };
  chat: CareerChatMessage[]; simulation: CareerSimulation|null; council: CareerCouncil|null;
};

const blank: Stored = {
  profile: { interests: [], skills: [], values: [], workStyle: [], constraints: { languages: [] } },
  priorities: { income: 50, stability: 50, creativity: 50, impact: 50, freedom: 50 },
  recommendations: [], clarity: null, summary: '', savedPaths: [], hiddenPaths: [], pathStatuses: {}, marketSignals: null,
  experiments: [], milestones: [], journal: [], pulse: null,
  settings: { excludeProfile: false, locale: 'en', theme: 'dark', language: 'English' },
  chat: [], simulation: null, council: null,
};
function normalizeStored(value: unknown): Stored {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return blank;
  const parsed = value as Record<string, any>;
  const d = parsed.version === 1 && parsed.data && typeof parsed.data === 'object'
    ? parsed.data
    : parsed;
  return {
    ...blank, ...d,
    profile: { ...blank.profile, ...(d.profile || {}), constraints: { ...blank.profile.constraints, ...(d.profile?.constraints || {}) } },
    priorities: { ...blank.priorities, ...(d.priorities || {}) },
    settings: { ...blank.settings, ...(d.settings || {}), theme: 'dark' },
    recommendations: Array.isArray(d.recommendations) ? d.recommendations : [],
    experiments: Array.isArray(d.experiments) ? d.experiments : [],
    milestones: Array.isArray(d.milestones) ? d.milestones : [],
    journal: Array.isArray(d.journal) ? d.journal : [],
    savedPaths: Array.isArray(d.savedPaths) ? d.savedPaths : [],
    hiddenPaths: Array.isArray(d.hiddenPaths) ? d.hiddenPaths : [],
    pathStatuses: d.pathStatuses && typeof d.pathStatuses === 'object' ? d.pathStatuses : {},
    chat: Array.isArray(d.chat) ? d.chat : [],
  };
}
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No date';
const labelize = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
const pages: { href: Page; label: string; icon: typeof Compass; group?: string }[] = [
  { href: '/today', label: 'Today', icon: Compass },
  { href: '/paths', label: 'Career paths', icon: Target },
  { href: '/lab', label: 'Experiment lab', icon: FlaskConical },
  { href: '/plan', label: 'Your plan', icon: Activity },
  { href: '/simulator', label: 'Future simulator', icon: TrendingUp },
  { href: '/journal', label: 'Journal', icon: Bookmark },
];
const priorities: { key: Priority; label: string; note: string }[] = [
  { key: 'income', label: 'Income', note: 'Earning potential' },
  { key: 'stability', label: 'Stability', note: 'Predictability & security' },
  { key: 'creativity', label: 'Creativity', note: 'Room to make & explore' },
  { key: 'impact', label: 'Impact', note: 'Meaningful contribution' },
  { key: 'freedom', label: 'Freedom', note: 'Autonomy & flexibility' },
];

function App() {
  const { user, signOut } = useAuth();
  const [data, setData] = useState<Stored>(blank);
  const [dataReady, setDataReady] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const dataRef = useRef(data);
  const lastPersisted = useRef('');
  const [path, setPath] = useLocation();
  const [chatOpen, setChatOpen] = useState(false);
  const [councilOpen, setCouncilOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [activeTitle, setActiveTitle] = useState('');
  const [duration, setDuration] = useState(3);
  const [councilConcern, setCouncilConcern] = useState('');
  const [chatInput, setChatInput] = useState('');
  const chatInFlightRef = useRef(false);
  const [filter, setFilter] = useState('All paths');

  const recMutation = useGenerateCareerRecommendations();
  const experimentMutation = useGenerateCareerExperiment();
  const simMutation = useSimulateCareerFutures();
  const councilMutation = useConsultCareerCouncil();
  const pulseMutation = useReflectOnWeeklyPulse();
  const chatMutation = useAskCareerCopilot();
  const marketMutation = useResearchCareerMarketSignals();

  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    if (!user || !firebaseDatabase) {
      setDataReady(false);
      return;
    }
    setDataReady(false);
    lastPersisted.current = '';
    const careerDataRef = ref(firebaseDatabase, `users/${user.uid}/careerData`);
    const unsubscribe = onValue(
      careerDataRef,
      snapshot => {
        const next = normalizeStored(snapshot.val());
        const serialized = JSON.stringify(next);
        lastPersisted.current = serialized;
        if (serialized !== JSON.stringify(dataRef.current)) {
          dataRef.current = next;
          setData(next);
        }
        setCloudError('');
        setDataReady(true);
      },
      () => {
        setCloudError('Could not load your Firebase data. Check your database rules and connection.');
        setDataReady(false);
      },
    );
    return () => unsubscribe();
  }, [user?.uid]);
  useEffect(() => {
    if (!user || !firebaseDatabase || !dataReady) return;
    const serialized = JSON.stringify(data);
    if (serialized === lastPersisted.current) return;
    const careerDataRef = ref(firebaseDatabase, `users/${user.uid}/careerData`);
    const timer = window.setTimeout(() => {
      lastPersisted.current = serialized;
      void set(careerDataRef, data).then(
        () => setCloudError(''),
        () => {
          if (lastPersisted.current === serialized) lastPersisted.current = '';
          setCloudError('Could not save your Firebase data. Check your database rules and connection.');
        },
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data, dataReady, user?.uid]);
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const update = (fn: (old: Stored) => Stored) => setData(old => fn(old));
  const clearCareerData = async () => {
    if (!user || !firebaseDatabase) return;
    if (!window.confirm('Permanently clear all Career Copilot data saved to your Firebase account? This cannot be undone.')) return;
    try {
      const emptyData = normalizeStored(null);
      await set(ref(firebaseDatabase, `users/${user.uid}/careerData`), emptyData);
      lastPersisted.current = JSON.stringify(emptyData);
      dataRef.current = emptyData;
      setData(emptyData);
      setToast('Your saved career data has been cleared.');
    } catch {
      setCloudError('Could not clear your Firebase data. Check your database rules and connection.');
    }
  };
  const profile = useMemo(() => data.settings.excludeProfile ? {} as CareerProfile : data.profile, [data.profile, data.settings.excludeProfile]);
  const profileComplete = Boolean(data.profile.stage && (data.profile.interests?.length || 0) > 0);
  const go = (to: Page) => setPath(to);
  const log = (kind: string, title: string, text: string) => update(d => ({ ...d, journal: [{ id: uid(), kind, title, text, date: new Date().toISOString() }, ...d.journal] }));
  const askRecommendations = () => recMutation.mutate({ data: { profile, priorities: data.priorities, locale: data.settings.locale } }, {
    onSuccess: result => {
      update(d => ({ ...d, recommendations: result.paths, clarity: result.clarityScore, summary: result.summary }));
      setToast('Recommendations are ready to review.');
    },
  });
  const makeExperiment = (title = activeTitle) => {
    if (!title) return;
    experimentMutation.mutate({ data: { profile, careerTitle: title, durationDays: duration, locale: data.settings.locale } }, {
      onSuccess: plan => { setActiveTitle(title); update(d => ({ ...d, experiments: [{ id: uid(), careerTitle: title, plan, status: 'active', step: 0, created: new Date().toISOString() }, ...d.experiments] })); log('experiment', plan.title, `Created a ${plan.durationDays}-day exploration for ${title}.`); setToast('Experiment saved to your lab.'); },
    });
  };
  const saveMilestone = (title: string, detail: string, proof = 'A small piece of work you can show') => update(d => ({ ...d, milestones: [...d.milestones, { id: uid(), title, detail, deadline: '', status: 'next', proof }] }));
  const askCouncil = (title: string) => { setActiveTitle(title); setCouncilOpen(true); };
  const runCouncil = () => councilMutation.mutate({ data: { profile, careerTitle: activeTitle || 'My next career decision', concern: councilConcern || undefined, locale: data.settings.locale } }, {
    onSuccess: result => { update(d => ({ ...d, council: result })); log('decision', `Council on ${activeTitle}`, result.synthesis); },
  });
  const runChat = (text = chatInput) => {
    const content = text.trim();
    if (!content || chatInFlightRef.current) return;
    chatInFlightRef.current = true;
    chatMutation.reset();
    const previousChat = data.chat;
    const userMessage: CareerChatMessage = { role: 'user', content };
    const messages: CareerChatMessage[] = [...data.chat, userMessage].slice(-11);
    update(d => ({ ...d, chat: [...d.chat, userMessage].slice(-11) }));
    setChatInput('');
    chatMutation.mutate({ data: { profile, messages, locale: data.settings.locale } }, {
      onSuccess: result => {
        chatInFlightRef.current = false;
        update(d => ({
          ...d,
          chat: [...d.chat, {
            role: 'assistant' as const,
            content: `${result.answer}${result.suggestedActions.length ? `\n\nA few next moves:\n${result.suggestedActions.map(action => `— ${action}`).join('\n')}` : ''}`,
          }].slice(-11),
        }));
      },
      onError: () => {
        chatInFlightRef.current = false;
        setChatInput(current => current || content);
        update(d => ({ ...d, chat: previousChat }));
      },
    });
  };
  const clearChat = () => {
    if (!data.chat.length || chatInFlightRef.current) return;
    if (!window.confirm('Permanently clear this Copilot conversation from your account? Other career data will stay. This cannot be undone.')) return;
    chatMutation.reset();
    setChatInput('');
    update(d => ({ ...d, chat: [] }));
  };
  const runPulse = (pulseOverride?: { mood: number; progress: string; blocker: string }) => {
    const p = pulseOverride || data.pulse;
    if (!p) return;
    pulseMutation.mutate({ data: { profile, mood: p.mood, progress: p.progress, blocker: p.blocker, locale: data.settings.locale } }, {
      onSuccess: result => { update(d => ({ ...d, pulse: { ...p, response: result } })); log('weekly pulse', 'A moment to recalibrate', result.nextStep); },
    });
  };
  const askSimulation = (title: string) => { setActiveTitle(title); simMutation.mutate({ data: { profile, careerTitle: title, locale: data.settings.locale } }, { onSuccess: result => { update(d => ({ ...d, simulation: result })); go('/simulator'); } }); };
  const research = (title: string) => marketMutation.mutate({ data: { careerTitle: title, region: data.profile.constraints?.location || 'your region', locale: data.settings.locale } }, { onSuccess: result => update(d => ({ ...d, marketSignals: result })) });

  if (!dataReady) {
    return cloudError
      ? <main className="data-load-error" role="alert"><img src={`${import.meta.env.BASE_URL}cairn-icon.png`} alt="" /><h1>Your workspace couldn’t load.</h1><p>{cloudError}</p><p>Your saved account data has not been changed.</p></main>
      : <div className="boot-skeleton" role="status" aria-label="Loading your career workspace"><span/><span/><span/></div>;
  }

  return (
    <div className="app-shell">
      <div className="grain" aria-hidden="true" />
      {path === '/onboarding' ? (
        <Onboarding data={data} update={update} onDone={() => go('/today')} />
      ) : (
        <div className="workspace">
          <header className="workspace-header">
            <div className="workspace-header-main">
              <Link href="/today" className="brand" aria-label="Cairn Career Copilot home">
                <span className="brand-mark"><img src={`${import.meta.env.BASE_URL}cairn-icon.png`} alt="" /></span>
                <span>cairn<span className="brand-dot">.</span><small>CAREER COPILOT</small></span>
              </Link>
              <div className="top-actions" aria-label="Account and assistant actions">
                <span className={`local-indicator ${cloudError ? 'sync-error' : ''}`} title={cloudError || 'Saved to your Firebase account'}><span/>{cloudError ? 'Sync issue' : 'Saved to account'}</span>
                <button className="icon-button" aria-label="Open Copilot chat" title="Ask Copilot" data-testid="button-open-copilot" onClick={() => setChatOpen(true)}><MessageCircle size={17}/></button>
                <button className="icon-button" aria-label="Open Career Council" title="Career Council" data-testid="button-open-career-council" onClick={() => { setCouncilOpen(true); setActiveTitle(data.recommendations[0]?.title || 'My next career decision'); }}><UsersRound size={17}/></button>
                <Link href="/me" className="top-avatar" aria-label="Open Career DNA" title={profileComplete ? 'Career DNA settings' : 'Set up Career DNA'}>{initials(data.profile)}</Link>
                <button className="icon-button sign-out-button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out" data-testid="button-sign-out"><LogOut size={16}/></button>
              </div>
            </div>
            <nav className="primary-nav" aria-label="Main navigation">
              {pages.map(item => {
                const Icon = item.icon;
                const active = path === item.href;
                return <Link key={item.href} href={item.href} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} data-testid={`link-${item.label.toLowerCase().replaceAll(' ', '-')}`}>
                  <Icon size={16}/><span>{item.label}</span>{item.href === '/lab' && data.experiments.some(e => e.status === 'active') && <i className="nav-dot" aria-label="Active experiment"/>}
                </Link>;
              })}
            </nav>
          </header>
          <main className="main-area">
            <div className="content-wrap fade-in" key={path}>
              {path === '/today' && <Today data={data} onNavigate={go} onGenerate={askRecommendations} onCouncil={askCouncil} onChat={() => setChatOpen(true)} recBusy={recMutation.isPending} recError={recMutation.error} onPulse={runPulse} pulseBusy={pulseMutation.isPending} update={update} />}
              {path === '/paths' && <Paths data={data} update={update} filter={filter} setFilter={setFilter} onGenerate={askRecommendations} busy={recMutation.isPending} recError={recMutation.error} onExperiment={(title: string) => { setActiveTitle(title); go('/lab'); }} onSetup={() => go('/onboarding')} onCouncil={askCouncil} onSimulate={askSimulation} onResearch={research} market={data.marketSignals} marketBusy={marketMutation.isPending} marketError={marketMutation.error} />}
              {path === '/lab' && <Lab data={data} title={activeTitle} setTitle={setActiveTitle} duration={duration} setDuration={setDuration} onGenerate={makeExperiment} busy={experimentMutation.isPending} error={experimentMutation.error} update={update} log={log} />}
              {path === '/plan' && <Plan data={data} update={update} onAdd={saveMilestone} />}
              {path === '/simulator' && <Simulator data={data} title={activeTitle} setTitle={setActiveTitle} onRun={askSimulation} busy={simMutation.isPending} error={simMutation.error} update={update} />}
              {path === '/journal' && <Journal data={data} update={update} onPulse={runPulse} pulseBusy={pulseMutation.isPending} />}
              {path === '/me' && <Me data={data} update={update} onClear={clearCareerData} />}
            </div>
          </main>
        </div>
      )}
      {chatOpen && <ChatPanel data={data} setOpen={setChatOpen} input={chatInput} setInput={setChatInput} onSend={runChat} onClear={clearChat} busy={chatMutation.isPending} error={chatMutation.error} />}
      {councilOpen && <CouncilPanel data={data} title={activeTitle} setTitle={setActiveTitle} concern={councilConcern} setConcern={setCouncilConcern} onRun={runCouncil} busy={councilMutation.isPending} error={councilMutation.error} onClose={() => setCouncilOpen(false)} />}
      {toast && <div role="status" className="toast"><CheckCircle2 size={17}/>{toast}<button aria-label="Dismiss" onClick={() => setToast('')}><X size={15}/></button></div>}
    </div>
  );
}
function initials(p: CareerProfile) { const text = p.interests?.[0] || 'CN'; return text.slice(0,2).toUpperCase(); }
function PrivacyNote({ small=false }: { small?: boolean }) { return <div className={`privacy-note ${small?'privacy-small':''}`}><ShieldCheck size={15}/><span>{small ? 'AI requests send only what each action needs. Gemini Free Tier prompts may be used to improve Google products; avoid sensitive details.' : 'Your career data is saved to your Firebase account. AI actions send only their required context to Gemini Free Tier. Google may use free-tier prompts to improve its products, so avoid sensitive details.'}</span></div>; }
function Header({ eyebrow, title, description, right }: { eyebrow: string; title: string; description?: string; right?: React.ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1 className="serif">{title}</h1>{description && <p>{description}</p>}</div>{right && <div className="heading-action">{right}</div>}</div>; }
function Button({ children, onClick, variant='primary', disabled=false, type='button', className='' }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary'|'secondary'|'plain'|'danger'; disabled?: boolean; type?: 'button'|'submit'; className?: string }) { return <button type={type} onClick={onClick} disabled={disabled} className={`button button-${variant} ${className}`}>{children}</button>; }
function Card({ children, className='' }: { children: React.ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
function TinyLabel({ children }: { children: React.ReactNode }) { return <div className="tiny-label">{children}</div>; }
function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const details = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const setupIssue = /GEMINI_API_KEY|gemini.*(key|config)|api key.*(missing|not configured)/i.test(details);
  const quotaIssue = /Gemini Free Tier quota|temporarily rate-limited/i.test(details);
  const groundingIssue = /Live web search grounding is not available/i.test(details);
  return <div className={`error-line ${setupIssue ? 'error-setup' : ''}`} role="status" data-testid="status-ai-error">
    <CircleHelp size={16}/>
    <span>{quotaIssue
      ? 'Gemini Free Tier is temporarily limited or out of quota. Check Google AI Studio’s usage limits and retry after they reset. No paid fallback was called; your saved workspace is safe.'
      : groundingIssue
        ? 'Live web research is not available on the no-cost Gemini model. Chat and other text-based AI actions remain available.'
      : setupIssue
        ? 'AI needs server setup: configure GEMINI_API_KEY from a Google AI Studio Free Tier project. Your saved workspace is safe.'
        : 'That didn’t come through. Check your connection and try again.'}</span>
  </div>;
}

function Today({ data, onNavigate, onGenerate, onCouncil, onChat, recBusy, recError, onPulse, pulseBusy, update }: any) {
  const current = data.experiments.find((e: ExperimentRecord) => e.status === 'active');
  const completed = data.experiments.filter((e: ExperimentRecord) => e.status === 'completed').length;
  return <>
    <Header eyebrow="MONDAY, YOUR WAY" title="A little more clarity." description="A considered next step beats a perfect five-year plan." right={<button className="button button-secondary" onClick={() => onNavigate('/me')}><Settings2 size={16}/> Edit Career DNA</button>}/>
    {!data.profile.stage && <div className="setup-banner"><div className="setup-icon"><Sparkles size={18}/></div><div><b>Start with what you know about yourself.</b><p>Your Career DNA helps make recommendations feel like yours. It can be edited anytime.</p></div><Button onClick={() => onNavigate('/onboarding')}>Set up my profile <ArrowRight size={15}/></Button></div>}
    <div className="today-grid">
      <section className="focus-feature">
        <div className="feature-top"><span className="eyebrow light">YOUR WEEKLY FOCUS</span><span className="week-chip">WEEK 01 <span>·</span> OPEN</span></div>
        <h2 className="serif">{current ? `Keep exploring ${current.careerTitle}.` : 'Make one small thing real.'}</h2>
        <p>{current ? current.plan.objective : 'Pick a path that sparks your curiosity. We’ll help you test it in a few hours, not commit your whole life to it.'}</p>
        <div className="focus-footer"><div className="focus-progress"><span style={{ width: `${current ? Math.round((current.step / current.plan.steps.length)*100) : 0}%` }}/></div><span>{current ? `${current.step} of ${current.plan.steps.length} steps` : 'No pressure to know yet'}</span></div>
        <button className="feature-cta" onClick={() => onNavigate(current ? '/lab' : '/paths')}>{current ? 'Pick up your experiment' : 'Explore possible paths'}<ArrowRight size={16}/></button>
        <div className="feature-orbit orbit-one"/><div className="feature-orbit orbit-two"/><span className="feature-stamp">PROGRESS<br/>OVER<br/>PERFECTION</span>
      </section>
      <div className="clarity-card card">
        <div className="clarity-head"><div><TinyLabel>CLARITY, NOT CERTAINTY</TinyLabel><h3 className="serif">{data.clarity ?? '—'}<small>{data.clarity ? '/100' : ' not measured'}</small></h3></div><span className="clarity-icon"><Lightbulb size={18}/></span></div>
        <p>{data.summary || 'Clarity grows with evidence. Your first recommendation round can give you a starting point.'}</p>
        <Button variant="secondary" disabled={recBusy || !data.profile.stage} onClick={onGenerate}>{recBusy ? 'Thinking through it…' : 'Refresh my paths'}<ArrowRight size={14}/></Button>
        <ErrorLine error={recError}/>
      </div>
      <div className="streak-card card">
        <TinyLabel>IN MOTION</TinyLabel><div className="streak-number">{completed}<span> experiments finished</span></div>
        <div className="streak-line"><span className="streak-dot"/><span>{data.milestones.filter((m: Milestone) => m.status === 'done').length} proof points added to your plan</span></div>
        <div className="small-bars">{[0,1,2,3,4,5,6].map((n: number) => <i key={n} className={n < Math.min(7, data.experiments.length + completed) ? 'on' : ''}/>)}</div>
        <button className="text-link" onClick={() => onNavigate('/journal')}>See your recent activity <ArrowRight size={13}/></button>
      </div>
    </div>
    <div className="section-row"><div><TinyLabel>A GENTLE NUDGE</TinyLabel><h2 className="serif">Curiosity is a useful signal.</h2></div><button className="text-link" onClick={onChat}>Ask Copilot anything <ArrowUpRight size={14}/></button></div>
    <div className="nudge-grid">
      <button className="nudge-card" onClick={() => onNavigate('/paths')}><span className="nudge-icon nudge-peach"><Compass size={18}/></span><div><b>Explore paths</b><small>See options with the why, not just a score.</small></div><ArrowRight size={15}/></button>
      <button className="nudge-card" onClick={() => onNavigate('/lab')}><span className="nudge-icon nudge-sage"><FlaskConical size={18}/></span><div><b>Try a tiny experiment</b><small>Test the work before you choose the title.</small></div><ArrowRight size={15}/></button>
      <button className="nudge-card" onClick={() => onCouncil(data.recommendations[0]?.title || 'My next move')}><span className="nudge-icon nudge-gold"><MessageCircle size={18}/></span><div><b>Hear four perspectives</b><small>Talk a decision through with the Council.</small></div><ArrowRight size={15}/></button>
    </div>
    <div className="today-bottom">
      <Card className="pulse-quick"><div className="card-topline"><div><TinyLabel>WEEKLY PULSE</TinyLabel><h3 className="serif">How did this week feel?</h3></div><span className="soft-tag">2 MIN</span></div>
        {data.pulse?.response ? <div className="pulse-result"><p>{data.pulse.response.reflection}</p><b>Try next: {data.pulse.response.nextStep}</b></div> : <>
          <div className="mood-row" role="radiogroup" aria-label="How was your week?">{['Heavy','A little stuck','Steady','Good','Energized'].map((m, i) => <button key={m} aria-checked={(data.pulse?.mood || 3) === i+1} role="radio" className={(data.pulse?.mood || 3) === i+1 ? 'mood-choice chosen' : 'mood-choice'} onClick={() => update((d: Stored) => ({ ...d, pulse: { mood: i+1, progress: d.pulse?.progress || '', blocker: d.pulse?.blocker || '' } }))}><span className={`mood-mark mood-${i}`}/>{m}</button>)}</div>
          <div className="pulse-fields"><input aria-label="Something that moved forward" placeholder="Something that moved forward…" value={data.pulse?.progress || ''} onChange={e => update((d: Stored) => ({ ...d, pulse: { mood: d.pulse?.mood || 3, progress: e.target.value, blocker: d.pulse?.blocker || '' } }))}/><input aria-label="Something that got in the way" placeholder="Something that got in the way…" value={data.pulse?.blocker || ''} onChange={e => update((d: Stored) => ({ ...d, pulse: { mood: d.pulse?.mood || 3, progress: d.pulse?.progress || '', blocker: e.target.value } }))}/><Button variant="secondary" disabled={pulseBusy || !data.pulse} onClick={onPulse}>{pulseBusy?'Reflecting…':'Reflect with Copilot'}</Button></div>
        </>}
      </Card>
      <div className="quote-card"><span className="quote-mark">“</span><blockquote className="serif">You don’t have to see the whole staircase. Just take the first step.</blockquote><small>A reminder for the in-between</small></div>
    </div>
    <PrivacyNote/>
  </>;
}

function Paths({ data, update, filter, setFilter, onGenerate, busy, recError, onExperiment, onSetup, onCouncil, onSimulate, onResearch, market, marketBusy, marketError }: any) {
  const filtered = data.recommendations.filter((p: CareerPath) => filter === 'All paths' ? !data.hiddenPaths.includes(p.id) : filter === 'Exploring' ? data.pathStatuses[p.id] === 'exploring' : filter === 'Saved' ? data.savedPaths.includes(p.id) : filter === 'Wildcard' ? p.wildcard : data.hiddenPaths.includes(p.id));
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [detail, setDetail] = useState<string|null>(null);
  return <>
    <Header eyebrow="POSSIBILITIES, WITH RECEIPTS" title="Paths worth a closer look." description="These are hypotheses, not verdicts. The useful part is what each one teaches you." right={<Button onClick={onGenerate} disabled={busy || !data.profile.stage}><WandSparkles size={16}/>{busy ? 'Finding patterns…' : 'Generate recommendations'}</Button>}/>
    <div className="notice-strip"><Lightbulb size={16}/><span>Recommendations use your interests, skills, values, constraints, and priorities. Each score is a transparent estimate, not a promise.</span><button onClick={() => setWeightsOpen(!weightsOpen)}>{weightsOpen?'Close':'Tune weights'}<Settings2 size={14}/></button></div>
    {weightsOpen && <Card className="weights-panel"><div className="weights-intro"><TinyLabel>WHAT MATTERS MOST</TinyLabel><h3 className="serif">Your priorities shape the order.</h3><p>Move a slider to tell us what deserves more weight. Changes save to your account.</p></div><div className="weight-controls">{priorities.map(item=><label key={item.key} className="weight-row"><span><b>{item.label}</b><small>{item.note}</small></span><input type="range" min="0" max="100" value={data.priorities[item.key]} aria-label={`${item.label} priority`} onChange={e=>update((d:Stored)=>({...d,priorities:{...d.priorities,[item.key]:Number(e.target.value)}}))}/><strong>{data.priorities[item.key]}</strong></label>)}</div></Card>}
    <div className="path-toolbar"><div className="filter-tabs">{['All paths','Exploring','Saved','Wildcard','Hidden'].map(f=><button key={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f}</button>)}</div><span>{filtered.length} {filtered.length===1?'path':'paths'} {data.recommendations.length?'to explore':'yet'}</span></div>
    {recError&&<ErrorLine error={recError}/>}
    {filtered.length ? <div className="path-list">{filtered.map((p:CareerPath,i:number)=><PathCard key={p.id} path={p} index={i} status={data.pathStatuses[p.id]||'considering'} saved={data.savedPaths.includes(p.id)} hidden={data.hiddenPaths.includes(p.id)} expanded={detail===p.id} onExpand={()=>setDetail(detail===p.id?null:p.id)} onStatus={(status:string)=>update((d:Stored)=>({...d,pathStatuses:{...d.pathStatuses,[p.id]:status as any}}))} onSave={()=>update((d:Stored)=>({...d,savedPaths:d.savedPaths.includes(p.id)?d.savedPaths.filter(x=>x!==p.id):[...d.savedPaths,p.id]}))} onHide={()=>update((d:Stored)=>({...d,hiddenPaths:d.hiddenPaths.includes(p.id)?d.hiddenPaths.filter(x=>x!==p.id):[...d.hiddenPaths,p.id]}))} onExperiment={()=>onExperiment(p.title)} onCouncil={()=>onCouncil(p.title)} onSimulate={()=>onSimulate(p.title)} onResearch={()=>onResearch(p.title)}/>)}</div> :
      <div className="empty-state"><span className="empty-icon"><Compass size={24}/></span><h3 className="serif">{data.recommendations.length ? 'Nothing in this view.' : 'Start with possibilities, not a test.'}</h3><p>{data.recommendations.length ? 'Try a different filter, or save a path you want to revisit.' : 'Once you’ve added a little Career DNA, ask Copilot to find paths grounded in what matters to you.'}</p><Button onClick={onGenerate} disabled={busy || !data.profile.stage}>{busy?'Thinking…':'Generate recommendations'}<ArrowRight size={15}/></Button>{!data.profile.stage&&<button className="text-link" onClick={onSetup}>Set up Career DNA first</button>}</div>}
    {market && <Card className="market-result"><TinyLabel>MARKET SIGNALS · {market.region}</TinyLabel><h3 className="serif">{market.summary}</h3><p>{market.caveat}</p><div className="signals">{(market.signals as CareerMarketSignals['signals']).map((s: any,i:number)=><div key={i}><b>{s.claim}</b><p>{s.implication}</p><a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.sourceTitle}<ArrowUpRight size={12}/></a></div>)}</div></Card>}
    {marketBusy && <div className="inline-loading"><span className="skeleton-line"/><span className="skeleton-line short"/>Researching live market context…</div>}
    {marketError&&<ErrorLine error={marketError}/>}
    <PrivacyNote small/>
  </>;
}
function PathCard({path,index,saved,hidden,status,onStatus,expanded,onExpand,onSave,onHide,onExperiment,onCouncil,onSimulate,onResearch}:any) {
  const breakdown=path.scoreBreakdown;
  return <article className={`path-card ${path.wildcard?'wildcard-card':''}`}>
    <div className="path-index">{String(index+1).padStart(2,'0')}<span>{path.wildcard?'OUTSIDE THE LINES':path.category}</span></div>
    <div className="path-main"><div className="path-card-title"><div><h3 className="serif">{path.title}</h3><p>{path.summary}</p></div>{path.wildcard&&<span className="wildcard-tag"><Sparkles size={12}/> WILDCARD</span>}</div>
      <div className="path-meta"><span><b>{path.fitScore}</b> fit estimate</span><span>{path.confidence}% confidence</span><span>{path.reasons.length} signals in your favor</span></div>
      <div className="fit-rail"><i style={{width:`${path.fitScore}%`}}/></div>
      <div className="path-actions"><button className="path-action primary-action" onClick={onExperiment}><FlaskConical size={14}/> Test this path <ArrowRight size={13}/></button><select className="path-status-select" aria-label={`Status for ${path.title}`} value={status} onChange={e=>onStatus(e.target.value)}><option value="considering">Considering</option><option value="exploring">Exploring</option><option value="paused">Paused</option><option value="ruled-out">Ruled out</option></select><button className="path-action" onClick={onExpand}>{expanded?'Less detail':'Why this fits'}<ChevronDown size={14}/></button><button className={`path-icon-action ${saved?'saved':''}`} aria-label={saved?'Remove saved path':'Save path'} title={saved?'Saved':'Save'} onClick={onSave}><Bookmark size={15}/></button><button className="path-icon-action" aria-label={hidden?'Restore path':'Hide path'} title={hidden?'Restore':'Hide'} onClick={onHide}><X size={15}/></button></div>
      {expanded&&<div className="path-detail fade-in"><div className="breakdown"><TinyLabel>FIT, BROKEN DOWN</TinyLabel>{Object.entries(breakdown).map(([k,v])=><div className="score-row" key={k}><span>{labelize(k)}</span><span className="score-track"><i style={{width:`${Number(v)}%`}}/></span><b>{Number(v)}</b></div>)}</div><div className="why-columns"><div><TinyLabel>WHAT LINES UP</TinyLabel>{path.reasons.map((r:string,i:number)=><p className="list-reason" key={i}><Check size={13}/>{r}</p>)}</div><div><TinyLabel>REAL TRADE-OFFS</TinyLabel>{path.risks.map((r:string,i:number)=><p className="list-reason risk" key={i}><ArrowDown size={13}/>{r}</p>)}</div></div>
        <div className="change-mind"><b>What could change this recommendation?</b>{path.whatWouldChangeMyMind.map((r:string,i:number)=><span key={i}>{r}</span>)}</div><div className="detail-actions"><button onClick={onCouncil}><MessageCircle size={14}/>Ask the Council</button><button onClick={onSimulate}><TrendingUp size={14}/>Compare futures</button><button onClick={onResearch}><Search size={14}/>Market signals</button></div>
      </div>}
    </div><div className="fit-score" aria-label={`Fit score ${path.fitScore}`}><span>{path.fitScore}</span><small>FIT</small></div>
  </article>;
}

function Lab({data,title,setTitle,duration,setDuration,onGenerate,busy,error,update,log}:any) {
  const [reflectionId,setReflectionId]=useState<string|null>(null);
  const [reflection,setReflection]=useState('');
  const [energy,setEnergy]=useState(3);
  const records:ExperimentRecord[]=data.experiments;
  const saveReflection=(item:ExperimentRecord)=>{update((d:Stored)=>({...d,experiments:d.experiments.map(e=>e.id===item.id?{...e,status:'completed',reflection,energy}:e),journal:[{id:uid(),kind:'experiment',title:`Finished: ${item.plan.title}`,text:reflection,date:new Date().toISOString()},...d.journal]}));setReflectionId(null);setReflection('');};
  const next=(item:ExperimentRecord)=>update((d:Stored)=>({...d,experiments:d.experiments.map(e=>e.id===item.id?{...e,step:Math.min(e.step+1,e.plan.steps.length)}:e)}));
  return <>
    <Header eyebrow="LOW-STAKES, HIGH-SIGNAL" title="The experiment lab." description="Get a feel for the actual work before making a big decision."/>
    <div className="lab-builder card"><div className="builder-illustration"><div className="beaker"><FlaskConical size={43}/><span/></div><span className="spark spark-a"/><span className="spark spark-b"/></div><div className="builder-copy"><TinyLabel>MAKE A SMALL BET</TinyLabel><h2 className="serif">Try on a career for size.</h2><p>We’ll turn a career idea into a short, real-world experiment. Make something. Talk to someone. Notice what gives you energy.</p><div className="builder-form"><label>Career or kind of work<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. climate policy researcher"/></label><label>Length<select value={duration} onChange={e=>setDuration(Number(e.target.value))}>{[1,2,3,4,5,6,7].map(d=><option key={d} value={d}>{d} {d===1?'day':'days'}</option>)}</select></label><Button disabled={!title.trim()||busy} onClick={()=>onGenerate(title)}>{busy?'Designing your experiment…':'Design my experiment'}<WandSparkles size={15}/></Button></div><ErrorLine error={error}/><PrivacyNote small/></div></div>
    {busy&&<div className="experiment-skeleton card"><span className="skeleton-line"/><span className="skeleton-line short"/><span className="skeleton-line"/><span className="skeleton-line short"/>Putting together practical steps…</div>}
    <div className="section-row lab-record-head"><div><TinyLabel>YOUR FIELD NOTES</TinyLabel><h2 className="serif">Experiments in motion</h2></div><span className="soft-tag">{records.length} SAVED</span></div>
    {!records.length?<div className="empty-state compact"><span className="empty-icon"><FlaskConical size={23}/></span><h3 className="serif">Your first test can be tiny.</h3><p>One afternoon of evidence is better than another week of wondering.</p></div>:
      <div className="experiment-list">{records.map(item=><Card key={item.id} className={`experiment-record ${item.status}`}><div className="record-head"><div><span className={`status-pill ${item.status}`}>{item.status==='active'?'IN PROGRESS':item.status==='completed'?'REFLECTED':'PAUSED'}</span><h3 className="serif">{item.plan.title}</h3><p>Exploring <b>{item.careerTitle}</b> · {item.plan.durationDays} days · {item.plan.timeEstimate}</p></div><button className="icon-button" title="Remove experiment" aria-label="Delete experiment" onClick={()=>update((d:Stored)=>({...d,experiments:d.experiments.filter(e=>e.id!==item.id)}))}><Trash2 size={15}/></button></div><p className="experiment-objective">{item.plan.objective}</p><div className="tool-row">{item.plan.tools.map((t:string)=><span key={t}>{t}</span>)}</div>
        <div className="experiment-steps">{item.plan.steps.map((step,i)=><div key={i} className={`experiment-step ${i<item.step?'step-done':''}`}><span className="step-check">{i<item.step?<Check size={12}/>:String(step.day).padStart(2,'0')}</span><div><span className="step-day">DAY {step.day}</span><h4>{step.title}</h4><p>{step.description}</p><small>PROOF · {step.proofOfWork}</small></div>{item.status==='active'&&i===item.step&&<button className="step-done-btn" onClick={()=>next(item)}>Mark done <Check size={14}/></button>}</div>)}</div>
        {item.status!=='completed'&&<div className="experiment-controls"><button className="path-action" onClick={()=>update((d:Stored)=>({...d,experiments:d.experiments.map(e=>e.id===item.id?{...e,status:e.status==='paused'?'active':'paused'}:e)}))}>{item.status==='paused'?'Resume experiment':'Pause for now'}</button>{item.status==='active'&&item.step>=item.plan.steps.length&&<Button onClick={()=>setReflectionId(reflectionId===item.id?null:item.id)}><Heart size={15}/>Reflect on this experiment</Button>}</div>}
        {reflectionId===item.id&&<div className="reflection-box"><TinyLabel>WHAT DID YOU NOTICE?</TinyLabel><div className="prompt-chips">{item.plan.reflectionPrompts.map((p:string,i:number)=><button key={i} onClick={()=>setReflection(reflection?`${reflection}\n${p} `:p+' ')}>{p}</button>)}</div><textarea value={reflection} onChange={e=>setReflection(e.target.value)} placeholder="What surprised you? What felt energizing or draining?"/><div className="energy-row"><span>Energy after doing this</span>{['Depleted','Low','Neutral','Alive','Want more'].map((v,i)=><button key={v} className={energy===i+1?'chosen':''} onClick={()=>setEnergy(i+1)} aria-label={`${i+1}: ${v}`}>{i+1}</button>)}</div><Button disabled={!reflection.trim()} onClick={()=>saveReflection(item)}>Save reflection</Button></div>}
        {item.reflection&&<div className="saved-reflection"><TinyLabel>YOUR REFLECTION · ENERGY {item.energy}/5</TinyLabel><p>{item.reflection}</p></div>}
        <div className="notice-line"><b>Pay attention to:</b> {item.plan.whatToNotice.join(' · ')}</div>
      </Card>)}</div>}
    <PrivacyNote/>
  </>;
}

function Plan({data,update,onAdd}:any) {
  const done=data.milestones.filter((m:Milestone)=>m.status==='done').length;
  const [form,setForm]=useState(false); const [title,setTitle]=useState(''); const [detail,setDetail]=useState(''); const [proof,setProof]=useState('');
  return <>
    <Header eyebrow="A PLAN THAT CAN CHANGE" title="Evidence over ambition." description="Your roadmap is a working document. Keep the next step small enough to actually happen." right={<Button onClick={()=>setForm(!form)}><Plus size={16}/>Add a milestone</Button>}/>
    <div className="plan-overview"><div className="plan-counter"><span className="serif">{done}<i>/</i>{data.milestones.length}</span><small>MILESTONES COMPLETE</small></div><div className="plan-progress"><div><b>Your proof-of-work trail</b><span>{done?`${Math.round(done/data.milestones.length*100)}% built`:'Start with one thing you can show'}</span></div><div className="plan-track"><i style={{width:`${data.milestones.length?done/data.milestones.length*100:0}%`}}/></div><p>{data.experiments.length} experiments started <span>·</span> {data.journal.length} moments captured</p></div><div className="plan-spark"><Target size={23}/><span>Make it<br/>showable.</span></div></div>
    {form&&<Card className="milestone-form"><button className="close-x" aria-label="Close" onClick={()=>setForm(false)}><X size={16}/></button><TinyLabel>ADD A PROOF POINT</TinyLabel><h3 className="serif">What would you like to make real?</h3><div className="form-grid"><label>Milestone<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Publish a small data story"/></label><label>Why this matters<input value={detail} onChange={e=>setDetail(e.target.value)} placeholder="What will it help you learn?"/></label><label>Proof you can show<input value={proof} onChange={e=>setProof(e.target.value)} placeholder="A link, artifact, or conversation"/></label></div><Button disabled={!title.trim()} onClick={()=>{onAdd(title,detail,proof||'A small piece of work you can show');setTitle('');setDetail('');setProof('');setForm(false);}}>Add to my roadmap <ArrowRight size={14}/></Button></Card>}
    <div className="section-row"><div><TinyLabel>YOUR ROADMAP</TinyLabel><h2 className="serif">Small steps, tangible proof.</h2></div><div className="timeline-key"><span><i className="key-dot doing-dot"/>IN MOTION</span><span><i className="key-dot"/>UP NEXT</span></div></div>
    {!data.milestones.length?<div className="empty-state compact"><span className="empty-icon"><Activity size={23}/></span><h3 className="serif">Your map starts with one milestone.</h3><p>Try adding a project, conversation, or small artifact that would make a path more real.</p><Button variant="secondary" onClick={()=>setForm(true)}><Plus size={15}/>Add first milestone</Button></div>:<div className="roadmap">{data.milestones.map((m:Milestone,i:number)=><article key={m.id} className={`milestone ${m.status}`}><div className="timeline-node">{m.status==='done'?<Check size={13}/>:String(i+1).padStart(2,'0')}</div><div className="milestone-body"><div className="milestone-top"><span className={`status-pill ${m.status}`}>{m.status==='done'?'DONE':m.status==='doing'?'IN MOTION':'UP NEXT'}</span><div className="milestone-controls"><input aria-label="Milestone due date" type="date" value={m.deadline} onChange={e=>update((d:Stored)=>({...d,milestones:d.milestones.map(x=>x.id===m.id?{...x,deadline:e.target.value}:x)}))}/><select aria-label="Milestone status" value={m.status} onChange={e=>update((d:Stored)=>({...d,milestones:d.milestones.map(x=>x.id===m.id?{...x,status:e.target.value as Milestone['status']}:x)}))}><option value="next">Up next</option><option value="doing">In motion</option><option value="done">Done</option></select><button className="icon-button" aria-label="Delete milestone" onClick={()=>update((d:Stored)=>({...d,milestones:d.milestones.filter(x=>x.id!==m.id)}))}><Trash2 size={14}/></button></div></div><h3 className="serif">{m.title}</h3><p>{m.detail||'A useful step toward more evidence.'}</p><div className="proof-chip"><CheckCircle2 size={14}/><span><b>Proof of work</b> · {m.proof}</span></div></div></article>)}</div>}
    <div className="plan-footnote"><ShieldCheck size={15}/> A roadmap is a hypothesis. Update it when you learn something new.</div>
  </>;
}

function Simulator({data,title,setTitle,onRun,busy,error,update}:any) {
  const sim:CareerSimulation|null=data.simulation;
  const toneClass=(tone:string)=>`tone-${tone}`;
  return <>
    <Header eyebrow="FUTURES, NOT FORECASTS" title="Try on a few tomorrows." description="Compare plausible directions without pretending anyone can predict your life."/>
    <div className="sim-start card"><div><TinyLabel>ONE CAREER, THREE LENSES</TinyLabel><h2 className="serif">What could this become?</h2><p>See steady, stretch, and pivot scenarios—with assumptions and risks in the open.</p></div><div className="sim-form"><label>Career to explore<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. product designer"/></label><Button disabled={!title.trim()||busy} onClick={()=>onRun(title)}>{busy?'Thinking through scenarios…':'Compare futures'}<ArrowRight size={15}/></Button><ErrorLine error={error}/></div></div>
    {busy&&<div className="scenario-loading"><div className="scenario-skel card"/><div className="scenario-skel card"/><div className="scenario-skel card"/></div>}
    {sim?<><div className="scenario-heading"><div><TinyLabel>THREE POSSIBLE VERSIONS</TinyLabel><h2 className="serif">{sim.careerTitle}</h2></div><span className="soft-tag">NOT A PREDICTION</span></div><p className="caveat">{sim.caveat}</p><div className="scenario-grid">{sim.scenarios.map((s,i)=><article key={i} className={`scenario-card ${toneClass(s.tone)}`}><div className="scenario-top"><span>{s.tone.toUpperCase()}</span><span>0{i+1}</span></div><h3 className="serif">{s.name}</h3><p>{s.description}</p><div className="year-track">{s.milestones.sort((a,b)=>a.year-b.year).map(m=><div className="year-item" key={m.year}><span>YEAR {m.year}</span><b>{m.headline}</b><p>{m.description}</p><div className="year-proof"><b>Proof</b>{m.proofOfWork}</div></div>)}</div><div className="scenario-lists"><div><TinyLabel>ASSUMES</TinyLabel>{s.assumptions.map((a,j)=><p key={j}>{a}</p>)}</div><div><TinyLabel>WATCH FOR</TinyLabel>{s.risks.map((r,j)=><p key={j}>{r}</p>)}</div></div><button className="scenario-save" onClick={()=>update((d:Stored)=>({...d,journal:[{id:uid(),kind:'scenario',title:`${s.name} · ${sim.careerTitle}`,text:s.description,date:new Date().toISOString()},...d.journal]}))}><Bookmark size={14}/>Save this scenario</button></article>)}</div></>:!busy&&<div className="sim-empty"><div className="sim-orbit"><span/><span/><span/></div><h3 className="serif">There’s more than one good version.</h3><p>Enter a career above to map three possible trajectories. Save a scenario when it helps you think.</p></div>}
    <PrivacyNote/>
  </>;
}

function Journal({data,update,onPulse,pulseBusy}:any) {
  const [mood,setMood]=useState(data.pulse?.mood||3);
  const [progress,setProgress]=useState(data.pulse?.progress||'');
  const [blocker,setBlocker]=useState(data.pulse?.blocker||'');
  const grouped=useMemo(()=>data.journal.reduce((acc:Record<string,JournalRecord[]>,item:JournalRecord)=>{const key=new Date(item.date).toLocaleDateString(undefined,{month:'long',year:'numeric'});(acc[key]??=[]).push(item);return acc;},{} as Record<string,JournalRecord[]>),[data.journal]);
  const savePulse=()=>{update((d:Stored)=>({...d,pulse:{mood,progress,blocker}}));onPulse({mood,progress,blocker});};
  const iconFor=(kind:string)=>kind==='experiment'?<FlaskConical size={15}/>:kind==='decision'?<MessageCircle size={15}/>:kind==='scenario'?<TrendingUp size={15}/>:<Heart size={15}/>;
  return <>
    <Header eyebrow="A RECORD OF BECOMING" title="Notice what’s changing." description="A place to keep the decisions, small wins, and honest answers you’ll want to remember."/>
    <Card className="weekly-pulse"><div className="pulse-heading"><span className="pulse-heart"><Heart size={20}/></span><div><TinyLabel>WEEKLY PULSE</TinyLabel><h2 className="serif">Take a moment to check in.</h2><p>No grades here. Just useful information about how your week actually felt.</p></div></div><div className="mood-scale"><span>THIS WEEK FELT</span>{['Difficult','Uncertain','Steady','Good','Energizing'].map((m,i)=><button key={m} className={mood===i+1?'chosen':''} onClick={()=>setMood(i+1)}><i className={`mood-mark mood-${i}`}/>{m}</button>)}</div><div className="journal-input-grid"><label>What moved forward?<textarea value={progress} onChange={e=>setProgress(e.target.value)} placeholder="Even something small counts…"/></label><label>What got in the way?<textarea value={blocker} onChange={e=>setBlocker(e.target.value)} placeholder="Name it without judging it…"/></label></div><div className="pulse-submit"><PrivacyNote small/><Button disabled={pulseBusy} onClick={savePulse}>{pulseBusy?'Reflecting…':'Reflect with Copilot'}<ArrowRight size={14}/></Button></div>{data.pulse?.response&&<div className="pulse-ai"><TinyLabel>A REFLECTION TO KEEP</TinyLabel><p>{data.pulse.response.reflection}</p><b>{data.pulse.response.adjustment}</b><span>Next: {data.pulse.response.nextStep}</span></div>}</Card>
    <div className="section-row journal-head"><div><TinyLabel>YOUR PRIVATE RECORD</TinyLabel><h2 className="serif">Recent entries</h2></div><span className="soft-tag">{data.journal.length} ENTRIES</span></div>
    {!data.journal.length?<div className="empty-state compact"><span className="empty-icon"><Bookmark size={22}/></span><h3 className="serif">Your record is yours to fill.</h3><p>Save experiments, thoughts from the Council, and scenarios you want to sit with.</p></div>:Object.entries(grouped).map(([month,items])=><section className="journal-month" key={month}><div className="month-marker"><span/>{month}</div><div className="journal-entries">{(items as JournalRecord[]).map((item:JournalRecord)=><article className="journal-entry" key={item.id}><div className={`journal-kind kind-${item.kind}`}>{iconFor(item.kind)}</div><div className="entry-content"><div className="entry-date">{dateLabel(item.date)} <span>·</span> {labelize(item.kind)}</div><h3 className="serif">{item.title}</h3><p>{item.text}</p></div><button className="icon-button" title="Delete journal entry" aria-label="Delete entry" onClick={()=>update((d:Stored)=>({...d,journal:d.journal.filter(x=>x.id!==item.id)}))}><Trash2 size={14}/></button></article>)}</div></section>)}
    <PrivacyNote/>
  </>;
}

function Me({data,update,onClear}:any) {
  const [tab,setTab]=useState('Career DNA');
  const [interestText,setInterestText]=useState((data.profile.interests||[]).join(', '));
  const [valuesText,setValuesText]=useState((data.profile.values||[]).join(', '));
  const [skillsText,setSkillsText]=useState((data.profile.skills||[]).map((s:any)=>`${s.name}|${s.level}|${s.evidence}`).join('\n'));
  const [saved,setSaved]=useState(false);
  const updateProfile=(field:string,value:any)=>update((d:Stored)=>({...d,profile:{...d.profile,[field]:value}}));
  const saveDNA=()=>{const skills=skillsText.split('\n').map((line:string)=>{const [name,level,evidence]=line.split('|');return name?.trim()?{name:name.trim(),level:Math.max(1,Math.min(5,Number(level)||3)),evidence:evidence?.trim()||''}:null;}).filter(Boolean); update((d:Stored)=>({...d,profile:{...d.profile,interests:interestText.split(',').map((x:string)=>x.trim()).filter(Boolean).slice(0,12),values:valuesText.split(',').map((x:string)=>x.trim()).filter(Boolean).slice(0,8),skills:skills as CareerProfile['skills']}}));setSaved(true);window.setTimeout(()=>setSaved(false),2000);};
  const exportData=()=>{const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),data},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cairn-career-data.json';a.click();URL.revokeObjectURL(a.href);};
  return <>
    <Header eyebrow="YOUR PERSONAL COMPASS" title="Career DNA." description="Not a label. A living picture of what matters, what you can do, and what’s possible."/>
    <div className="settings-layout"><nav className="settings-tabs" aria-label="Career profile settings">{['Career DNA','Preferences','Privacy & data'].map(t=><button type="button" key={t} className={tab===t?'selected':''} aria-pressed={tab===t} data-testid={`settings-tab-${t.toLowerCase().replaceAll(' ','-').replace('&','and')}`} onClick={()=>setTab(t)}>{t==='Career DNA'?<Compass size={16}/>:t==='Preferences'?<Settings2 size={16}/>:<LockKeyhole size={16}/>} <span>{t}</span></button>)}</nav>
      <div className="settings-content">
        {tab==='Career DNA'&&<><Card className="dna-intro"><div className="dna-orb"><Compass size={25}/></div><div><TinyLabel>THIS IS YOURS TO EDIT</TinyLabel><h2 className="serif">A starting point, never a box.</h2><p>Use what’s true today. Change your mind later. Your profile is saved to your Firebase account.</p></div></Card>
          <Card className="settings-card"><div className="settings-card-head"><div><TinyLabel>WHERE YOU ARE</TinyLabel><h3 className="serif">Your current chapter</h3></div></div><div className="choice-grid">{[{k:'class-10',n:'School · year 10'},{k:'class-12',n:'School · year 12'},{k:'college',n:'College / university'},{k:'early-career',n:'Early career'},{k:'exploring',n:'Exploring / changing'}].map(x=><button className={data.profile.stage===x.k?'choice selected':''} key={x.k} onClick={()=>updateProfile('stage',x.k)}>{x.n}{data.profile.stage===x.k&&<Check size={14}/>}</button>)}</div></Card>
          <Card className="settings-card"><TinyLabel>WHAT PULLS YOUR ATTENTION?</TinyLabel><h3 className="serif">Interests</h3><p className="settings-hint">Comma-separated. Add questions, topics, or things you lose track of time doing.</p><textarea value={interestText} onChange={e=>setInterestText(e.target.value)} placeholder="e.g. how cities work, visual storytelling, helping people learn"/><div className="suggestion-pills">{['Making things','Solving puzzles','Helping people','Understanding systems'].map(s=><button key={s} onClick={()=>setInterestText((interestText?interestText+', ':'')+s)}><Plus size={12}/>{s}</button>)}</div></Card>
          <Card className="settings-card"><TinyLabel>WHAT YOU ALREADY KNOW HOW TO DO</TinyLabel><h3 className="serif">Skills & evidence</h3><p className="settings-hint">One per line: skill | level (1–5) | how you know. Evidence can be a class project, a job, or teaching yourself.</p><textarea className="skills-editor" value={skillsText} onChange={e=>setSkillsText(e.target.value)} placeholder={'Writing | 3 | Edited the school paper\nPython | 2 | Made a small data project'} /></Card>
          <Card className="settings-card"><TinyLabel>WHAT SHOULD WORK MAKE ROOM FOR?</TinyLabel><h3 className="serif">Values & work style</h3><label className="settings-label">Values, separated by commas<textarea value={valuesText} onChange={e=>setValuesText(e.target.value)} placeholder="Autonomy, learning, useful work"/></label><div className="choice-grid style-grid">{['Deep focus','Collaborative','Hands-on','Independent','Structured','Flexible'].map(s=><button key={s} className={`choice ${(data.profile.workStyle||[]).includes(s)?'selected':''}`} onClick={()=>updateProfile('workStyle',(data.profile.workStyle||[]).includes(s)?data.profile.workStyle.filter((x:string)=>x!==s):[...(data.profile.workStyle||[]),s])}>{s}</button>)}</div></Card>
          <Card className="settings-card"><TinyLabel>REAL-LIFE CONSTRAINTS</TinyLabel><h3 className="serif">Design around your reality.</h3><div className="constraint-grid"><label>Location<input value={data.profile.constraints?.location||''} onChange={e=>update((d:Stored)=>({...d,profile:{...d.profile,constraints:{...d.profile.constraints,location:e.target.value}}}))} placeholder="City, region, or remote"/></label><label>Time available each week<input type="number" min="0" max="80" value={data.profile.constraints?.timeHoursPerWeek??''} onChange={e=>update((d:Stored)=>({...d,profile:{...d.profile,constraints:{...d.profile.constraints,timeHoursPerWeek:Number(e.target.value)}}}))} placeholder="Hours"/></label><label>Budget for learning<select value={data.profile.constraints?.budget||''} onChange={e=>update((d:Stored)=>({...d,profile:{...d.profile,constraints:{...d.profile.constraints,budget:e.target.value as any}}}))}><option value="">Not sure yet</option><option value="limited">Limited</option><option value="moderate">Moderate</option><option value="flexible">Flexible</option></select></label><label>Risk comfort<select value={data.profile.constraints?.riskTolerance||''} onChange={e=>update((d:Stored)=>({...d,profile:{...d.profile,constraints:{...d.profile.constraints,riskTolerance:e.target.value as any}}}))}><option value="">Not sure yet</option><option value="low">Prefer predictable</option><option value="medium">Some uncertainty is okay</option><option value="high">Comfortable with risk</option></select></label><label>Education level<input value={data.profile.constraints?.educationLevel||''} onChange={e=>update((d:Stored)=>({...d,profile:{...d.profile,constraints:{...d.profile.constraints,educationLevel:e.target.value}}}))} placeholder="Current or highest"/></label><label>Languages<input value={(data.profile.constraints?.languages||[]).join(', ')} onChange={e=>update((d:Stored)=>({...d,profile:{...d.profile,constraints:{...d.profile.constraints,languages:e.target.value.split(',').map((x:string)=>x.trim()).filter(Boolean)}}}))} placeholder="English, Spanish…"/></label></div></Card>
          <div className="save-row"><span>{saved?<><Check size={14}/> Saved to your account</>:'Edits sync to your account as you go.'}</span><Button onClick={saveDNA}>{saved?'Saved':'Save Career DNA'}<Check size={14}/></Button></div>
        </>}
        {tab==='Preferences'&&<><Card className="settings-card"><TinyLabel>HOW THE SPACE FEELS</TinyLabel><h3 className="serif">Display</h3><div className="preference-row"><div><b>Appearance</b><small>Cairn stays in dark mode.</small></div><span className="appearance-lock"><Moon size={14}/>Always dark</span></div><div className="preference-row"><div><b>Language</b><small>Used for AI responses.</small></div><select value={data.settings.language} onChange={e=>update((d:Stored)=>({...d,settings:{...d.settings,language:e.target.value,locale:e.target.value==='English'?'en':e.target.value==='Español'?'es':e.target.value==='Français'?'fr':'en'}}))}><option>English</option><option>Español</option><option>Français</option></select></div></Card><Card className="settings-card"><TinyLabel>AI CONTEXT</TinyLabel><h3 className="serif">Your information, on your terms.</h3><p className="settings-hint">AI actions send only the context needed for that action. This switch excludes Career DNA from every AI request; results may be less personal. Gemini Free Tier prompts may be used to improve Google products; avoid sensitive details.</p><label className="toggle-row"><span><b>Exclude Career DNA from AI requests</b><small>Your profile still stays in your Firebase account.</small></span><input type="checkbox" checked={data.settings.excludeProfile} onChange={e=>update((d:Stored)=>({...d,settings:{...d.settings,excludeProfile:e.target.checked}}))}/></label><PrivacyNote/></Card></>}
        {tab==='Privacy & data'&&<><Card className="privacy-card"><span className="privacy-large"><LockKeyhole size={22}/></span><div><TinyLabel>FIREBASE ACCOUNT STORAGE</TinyLabel><h3 className="serif">Your workspace is yours.</h3><p>Career DNA, recommendations, experiments, journal entries, and settings are saved to your Firebase account and scoped to your sign-in.</p></div></Card><Card className="settings-card"><TinyLabel>YOUR DATA, YOUR CALL</TinyLabel><h3 className="serif">Take it with you—or clear it.</h3><p className="settings-hint">Export a readable JSON copy of your account data. Clearing is permanent and cannot be undone.</p><div className="data-actions"><Button variant="secondary" onClick={exportData}><Download size={15}/>Download my data</Button><Button variant="danger" onClick={onClear}><Trash2 size={15}/>Clear saved data</Button></div></Card><Card className="settings-card"><TinyLabel>WHAT LEAVES YOUR ACCOUNT</TinyLabel><h3 className="serif">Only what an AI action needs.</h3><p className="settings-hint">Career actions send only their required context to Gemini Free Tier. Cairn does not save prompts or responses on its API, but Google may use free-tier prompts to improve products. Turn on “Exclude Career DNA” to omit your profile; avoid sensitive details.</p><PrivacyNote/></Card></>}
      </div>
    </div>
  </>;
}

function Onboarding({data,update,onDone}:any) {
  const [step,setStep]=useState(0);
  const [interests,setInterests]=useState((data.profile.interests||[]).join(', '));
  const [values,setValues]=useState((data.profile.values||[]).join(', '));
  const [skill,setSkill]=useState('');
  const stages=[{v:'class-10',l:'School, year 10'}, {v:'class-12',l:'School, year 12'}, {v:'college',l:'College or university'}, {v:'early-career',l:'Early career'}, {v:'exploring',l:'Exploring a change'}];
  const save=()=>update((d:Stored)=>({...d,profile:{...d.profile,interests:interests.split(',').map((s:string)=>s.trim()).filter(Boolean),values:values.split(',').map((s:string)=>s.trim()).filter(Boolean),skills:skill?skill.split(',').map((name:string)=>({name:name.trim(),level:3,evidence:''})).filter((s:any)=>s.name):d.profile.skills}}));
  const next=()=>{save();if(step<3)setStep(step+1);else onDone();};
  return <div className="onboarding-page"><header className="onboarding-head"><Link href="/today" className="brand dark-brand"><span className="brand-mark"><img src={`${import.meta.env.BASE_URL}cairn-icon.png`} alt=""/></span><span>cairn<span className="brand-dot">.</span><small>CAREER COPILOT</small></span></Link><span>PRIVATE BY DEFAULT <LockKeyhole size={13}/></span></header><div className="onboard-progress">{[0,1,2,3].map(i=><i key={i} className={i<=step?'filled':''}/>)}</div><main className="onboard-content fade-in" key={step}><span className="onboard-step">A CONVERSATION, NOT A QUIZ <span>0{step+1} / 04</span></span>
    {step===0&&<><div className="hello-mark"><Compass size={23}/></div><h1 className="serif">There isn’t one right<br/>way to figure it out.</h1><p className="onboard-lede">This is a space to explore work that might fit you—by trying small things, noticing what you learn, and changing direction whenever you need to.</p><div className="onboard-promise"><span><Check size={14}/></span>No personality test. No pressure to decide.<br/><span><Check size={14}/></span>Your details sync to your Firebase account.</div><Button onClick={next}>Let’s start with where you are <ArrowRight size={15}/></Button></>}
    {step===1&&<><h1 className="serif">First, what chapter<br/>are you in?</h1><p className="onboard-lede">There’s no wrong answer, and you can change it any time.</p><div className="onboard-choices">{stages.map(s=><button key={s.v} className={data.profile.stage===s.v?'onboard-choice selected':'onboard-choice'} onClick={()=>update((d:Stored)=>({...d,profile:{...d.profile,stage:s.v}}))}>{s.l}{data.profile.stage===s.v&&<Check size={15}/>}</button>)}</div><div className="onboard-controls"><button className="text-link" onClick={()=>setStep(0)}><ArrowLeft size={14}/> Back</button><Button onClick={next}>Continue <ArrowRight size={15}/></Button></div></>}
    {step===2&&<><h1 className="serif">What keeps<br/>you curious?</h1><p className="onboard-lede">Anything counts: a problem you like solving, a subject you return to, or work you admire.</p><label className="onboard-label">A few interests, separated by commas<textarea value={interests} onChange={e=>setInterests(e.target.value)} placeholder="e.g. why people behave the way they do, drawing, climate…"/></label><div className="suggestion-pills">{['People','Ideas','Making','Nature','Systems'].map(s=><button key={s} onClick={()=>setInterests((interests?interests+', ':'')+s)}><Plus size={12}/>{s}</button>)}</div><div className="onboard-controls"><button className="text-link" onClick={()=>setStep(1)}><ArrowLeft size={14}/> Back</button><Button onClick={next}>Continue <ArrowRight size={15}/></Button></div></>}
    {step===3&&<><h1 className="serif">Let’s make this<br/>fit your real life.</h1><p className="onboard-lede">The parts that matter most are yours to name. You can fill in details later.</p><label className="onboard-label">What would you like work to make room for?<input value={values} onChange={e=>setValues(e.target.value)} placeholder="e.g. stability, learning, helping people"/></label><label className="onboard-label">Anything you already know how to do? <span className="optional">OPTIONAL</span><input value={skill} onChange={e=>setSkill(e.target.value)} placeholder="e.g. writing, organizing, fixing things"/></label><div className="onboard-finish-note"><ShieldCheck size={16}/> Nothing is set in stone. Edit or clear your profile any time.</div><div className="onboard-controls"><button className="text-link" onClick={()=>setStep(2)}><ArrowLeft size={14}/> Back</button><Button onClick={()=>{save();onDone();}}>Open my workspace <ArrowRight size={15}/></Button></div></>}
    </main><footer className="onboard-footer">Your path belongs to you. We’re here to make exploring it a little easier.</footer></div>;
}

function ChatPanel({data,setOpen,input,setInput,onSend,onClear,busy,error}:any) {
  const send=(e:any)=>{e.preventDefault();onSend();};
  return <>
    <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <section className="side-panel chat-panel" role="dialog" aria-modal="true" aria-label="Ask Copilot">
        <header className="panel-head">
          <div className="chat-avatar"><Sparkles size={18}/></div>
          <div><TinyLabel>CAIRN COPILOT</TinyLabel><b>A thinking partner</b><small>Curious, practical, never pushy.</small></div>
          <button data-testid="button-clear-chat-history" className="icon-button" disabled={busy||!data.chat.length} onClick={onClear} aria-label="Clear chat history" title="Clear chat history"><Trash2 size={16}/></button>
          <button className="icon-button" onClick={()=>setOpen(false)} aria-label="Close chat"><X size={18}/></button>
        </header>
        <div className="chat-context"><ShieldCheck size={14}/>{data.settings.excludeProfile?'Career DNA is excluded. Messages go to Gemini Free Tier, where prompts may be used to improve Google products. Avoid sensitive details.':'Relevant profile context and messages go to Gemini Free Tier; prompts may be used to improve Google products. Avoid sensitive details.'}</div>
        <div className="chat-messages">
          {!data.chat.length&&<div className="chat-welcome"><span className="chat-welcome-icon"><MessageCircle size={19}/></span><h2 className="serif">What are you turning over?</h2><p>Ask for help comparing options, getting unstuck, or finding a useful next step.</p><div className="suggested-prompts">{['I’m torn between two paths','How do I test this without spending much?','What should I do this week?'].map(x=><button key={x} onClick={()=>onSend(x)}>{x}<ArrowUpRight size={13}/></button>)}</div></div>}
          {data.chat.map((m:CareerChatMessage,i:number)=><div className={`chat-bubble ${m.role}`} key={i}>{m.role==='assistant'&&<span className="mini-spark"><Sparkles size={12}/></span>}{m.content}</div>)}
          {busy&&<div className="chat-bubble assistant typing"><i/><i/><i/></div>}
          <ErrorLine error={error}/>
        </div>
        <form className="chat-form" onSubmit={send}>
          <textarea data-testid="input-chat-message" aria-label="Your message" disabled={busy} value={input} onChange={e=>setInput(e.target.value)} placeholder="A question, a worry, a half-formed thought…" rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onSend();}}}/>
          <button data-testid="button-send-chat" disabled={busy||!input.trim()} aria-label="Send message"><Send size={17}/></button>
          <small>Enter to send · Shift + Enter for a new line</small>
        </form>
      </section>
    </div>
  </>;
}

function CouncilPanel({data,title,setTitle,concern,setConcern,onRun,busy,error,onClose}:any) {
  const council:CareerCouncil|null=data.council;
  const voices:Record<string,string>={realist:'The realist',optimist:'The optimist',employer:'The employer',family:'Someone who cares'};
  const glyphs:Record<string,string>={realist:'R',optimist:'O',employer:'E',family:'F'};
  return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal council-modal" role="dialog" aria-modal="true" aria-label="Career Council"><header className="modal-head"><div><TinyLabel>FOUR USEFUL LENSES</TinyLabel><h2 className="serif">The Career Council</h2></div><button className="icon-button" onClick={onClose} aria-label="Close Council"><X size={18}/></button></header><p className="council-intro">Not four people who know your future. Four perspectives to help you ask better questions about it.</p><label>Career or decision<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What are you thinking about?"/></label><label>What feels uncertain? <span className="optional">OPTIONAL</span><textarea value={concern} onChange={e=>setConcern(e.target.value)} placeholder="Name the real tension, if there is one."/></label><Button disabled={!title.trim()||busy} onClick={onRun}>{busy?'Gathering perspectives…':'Ask the Council'}<ArrowRight size={15}/></Button><ErrorLine error={error}/>
    {council&&<div className="council-result fade-in"><div className="council-voices">{council.voices.map((v,i)=><article className={`voice voice-${v.perspective}`} key={i}><span className="voice-mark">{glyphs[v.perspective]||'C'}</span><div><TinyLabel>{voices[v.perspective]||labelize(v.perspective)}</TinyLabel><h3>{v.headline}</h3><p>{v.view}</p><div className="voice-question">Worth asking: {v.question}</div></div></article>)}</div><div className="council-synthesis"><TinyLabel>WHERE THE THREADS MEET</TinyLabel><p>{council.synthesis}</p><b>A conversation starter</b><span>{council.conversationStarter}</span></div></div>}
    <PrivacyNote small/>
  </section></div>;
}

function RootRouter() {
  return <Switch>
    <Route path="/" component={()=><RootRedirect/>}/>
    <Route path="/onboarding" component={App}/>
    <Route path="/today" component={App}/>
    <Route path="/paths" component={App}/>
    <Route path="/lab" component={App}/>
    <Route path="/plan" component={App}/>
    <Route path="/simulator" component={App}/>
    <Route path="/journal" component={App}/>
    <Route path="/me" component={App}/>
    <Route component={()=><div className="not-found"><h1 className="serif">That page isn’t on this map.</h1><Link href="/today" className="button button-primary">Back to today <ArrowRight size={14}/></Link></div>}/>
  </Switch>;
}
function RootRedirect() { const [,setLocation]=useLocation(); useEffect(()=>{setLocation('/today');},[setLocation]); return <div className="boot-skeleton"><span/><span/><span/></div>; }
function AppGate() {
  const { user, loading, busy, error, signIn, signUp } = useAuth();
  if (loading) return <div className="boot-skeleton" role="status" aria-label="Loading Cairn"><span/><span/><span/></div>;
  if (!user) {
    const setupError = !firebaseConfigured
      ? 'Add the Firebase web app settings to enable sign-in and account creation.'
      : '';
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} busy={busy} error={error || setupError} />;
  }
  return <RootRouter />;
}
function AppRoot(){ return <QueryClientProvider client={queryClient}><Router><AuthProvider><AppGate /></AuthProvider></Router></QueryClientProvider>; }
export default AppRoot;
