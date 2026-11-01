/* TAKATAK LIVE ID — browser flow. Captures, never decides: every check is made on the server. */

type Locale = 'fr' | 'en';
type Step = 'consent' | 'phone' | 'email' | 'liveness' | 'id_document';
type Move = 'left' | 'right' | 'up' | 'down';

interface FlowState {
  client: { id: string; name: string };
  status: 'pending' | 'completed' | 'denied' | 'failed' | 'expired';
  locale: Locale;
  display: 'page' | 'popup';
  csrf: string;
  steps: Array<{ step: Step; done: boolean }>;
  next: Step | 'done' | null;
  phone: string | null;
  email: string | null;
  attempts: { livenessLeft: number; idLeft: number };
}

interface Challenge {
  challengeId: string;
  digits: string;
  moves: Move[];
  plan: { speakMs: number; moveMs: number; centerMs: number; fps: number };
}

const STR = {
  fr: {
    lang: 'EN',
    loading: 'Chargement…',
    wants: (n: string) => `${n} veut vérifier votre identité`,
    intro: 'TAKATAK LIVE ID confirme qu’une vraie personne est là, et que c’est bien vous. Cela protège contre les robots et la fraude.',
    willCheck: 'Ce qui sera vérifié, dans cet ordre :',
    s_phone: 'Votre numéro de téléphone (code par texto)',
    s_email: 'Votre courriel (code par courriel)',
    s_liveness: 'Vérification en direct : dire des chiffres à voix haute, puis tourner la tête',
    s_id: 'Le recto de votre pièce d’identité, comparé à votre visage',
    privacy:
      'Vie privée : la caméra et le micro servent seulement pendant la vérification. Les images et le son sont analysés puis effacés aussitôt ; aucune photo n’est conservée. Votre visage n’est pas stocké dans une banque. Vous pouvez refuser.',
    consentBox: (n: string) =>
      `J’accepte que TAKATAK LIVE ID vérifie mon identité pour ${n}, y compris l’analyse de mon visage et de ma voix (données biométriques), aux seules fins de cette vérification.`,
    accept: 'Accepter et continuer',
    refuse: 'Refuser',
    phoneTitle: 'Votre numéro de téléphone',
    phoneHelp: 'Nous envoyons un code à 6 chiffres par texto.',
    phoneLabel: 'Numéro de cellulaire',
    sendCode: 'Envoyer le code',
    codeTitle: 'Entrez le code reçu',
    codeSentTo: (to: string) => `Code envoyé à ${to}.`,
    codeLabel: 'Code à 6 chiffres',
    verify: 'Vérifier',
    resend: 'Renvoyer un code',
    change: 'Changer',
    emailTitle: 'Votre courriel',
    emailHelp: 'Nous envoyons un code à 6 chiffres par courriel.',
    emailLabel: 'Adresse courriel',
    liveTitle: 'Vérification en direct',
    liveHelp:
      'Placez votre visage dans l’ovale, bien éclairé, seul devant la caméra. Vous allez : 1) lire 4 chiffres à voix haute ; 2) tourner la tête dans l’ordre affiché. Environ 20 secondes.',
    liveSayLang: 'Dites les chiffres en français ou en anglais.',
    startCamera: 'Démarrer la caméra et le micro',
    ready: 'Je suis prêt',
    say: 'Dites à voix haute :',
    turn: { left: 'Tournez la tête à GAUCHE', right: 'Tournez la tête à DROITE', up: 'Levez la tête vers le HAUT', down: 'Baissez la tête vers le BAS' },
    center: 'Regardez la caméra',
    rec: '● ENREGISTREMENT',
    analyzing: 'Analyse en cours… (quelques secondes)',
    livePassed: 'Vérification en direct réussie.',
    tryAgain: 'Réessayer',
    attemptsLeft: (n: number) => `Essais restants : ${n}`,
    idTitle: 'Recto de votre pièce d’identité',
    idHelp:
      'Permis de conduire, carte d’assurance maladie avec photo ou passeport. Le recto seulement. Placez la carte dans le cadre, à plat, sans reflet, le texte lisible.',
    openCamera: 'Ouvrir la caméra',
    capture: 'Prendre la photo',
    usePhoto: 'Envoyer cette photo',
    retake: 'Reprendre',
    idPassed: 'Pièce d’identité vérifiée : c’est bien vous.',
    doneTitle: 'Identité vérifiée',
    doneText: (n: string) => `Merci. Vous retournez à ${n}.`,
    continue: 'Continuer',
    failedTitle: 'Vérification impossible',
    failedText: 'La vérification n’a pas pu être complétée. Vous pouvez retourner au site et recommencer plus tard.',
    back: 'Retourner au site',
    expired: 'Cette vérification a expiré. Retournez au site pour recommencer.',
    denied: 'Vérification refusée.',
    completedAlready: 'Cette vérification est déjà terminée.',
    needCamera: 'Autorisez la caméra et le micro dans votre navigateur, puis réessayez.',
    unsupported: 'Ce navigateur ne permet pas la vérification en direct. Utilisez Chrome, Safari, Edge ou Firefox récent.',
  },
  en: {
    lang: 'FR',
    loading: 'Loading…',
    wants: (n: string) => `${n} wants to verify your identity`,
    intro: 'TAKATAK LIVE ID confirms a real person is here, and that it is you. It protects against bots and fraud.',
    willCheck: 'What will be checked, in this order:',
    s_phone: 'Your phone number (code by text message)',
    s_email: 'Your email (code by email)',
    s_liveness: 'Live check: say numbers out loud, then turn your head',
    s_id: 'The front of your ID, compared with your face',
    privacy:
      'Privacy: the camera and microphone are used only during the check. Images and sound are analysed and deleted right away; no photo is kept. Your face is not stored in a database. You can refuse.',
    consentBox: (n: string) =>
      `I agree that TAKATAK LIVE ID verifies my identity for ${n}, including analysis of my face and voice (biometric data), only for this verification.`,
    accept: 'Accept and continue',
    refuse: 'Refuse',
    phoneTitle: 'Your phone number',
    phoneHelp: 'We send a 6-digit code by text message.',
    phoneLabel: 'Mobile number',
    sendCode: 'Send code',
    codeTitle: 'Enter the code you received',
    codeSentTo: (to: string) => `Code sent to ${to}.`,
    codeLabel: '6-digit code',
    verify: 'Verify',
    resend: 'Send a new code',
    change: 'Change',
    emailTitle: 'Your email',
    emailHelp: 'We send a 6-digit code by email.',
    emailLabel: 'Email address',
    liveTitle: 'Live check',
    liveHelp:
      'Put your face in the oval, in good light, alone in front of the camera. You will: 1) read 4 numbers out loud; 2) turn your head in the order shown. About 20 seconds.',
    liveSayLang: 'Say the numbers in English or French.',
    startCamera: 'Start camera and microphone',
    ready: 'I’m ready',
    say: 'Say out loud:',
    turn: { left: 'Turn your head LEFT', right: 'Turn your head RIGHT', up: 'Tilt your head UP', down: 'Tilt your head DOWN' },
    center: 'Look at the camera',
    rec: '● RECORDING',
    analyzing: 'Analysing… (a few seconds)',
    livePassed: 'Live check passed.',
    tryAgain: 'Try again',
    attemptsLeft: (n: number) => `Attempts left: ${n}`,
    idTitle: 'Front of your ID',
    idHelp: 'Driver’s licence, health card with photo, or passport. Front only. Put the card in the frame, flat, no glare, text readable.',
    openCamera: 'Open camera',
    capture: 'Take photo',
    usePhoto: 'Send this photo',
    retake: 'Retake',
    idPassed: 'ID verified: it is you.',
    doneTitle: 'Identity verified',
    doneText: (n: string) => `Thank you. Returning you to ${n}.`,
    continue: 'Continue',
    failedTitle: 'Verification not possible',
    failedText: 'The verification could not be completed. You can go back to the site and try again later.',
    back: 'Back to the site',
    expired: 'This verification expired. Go back to the site to start again.',
    denied: 'Verification refused.',
    completedAlready: 'This verification is already complete.',
    needCamera: 'Allow the camera and microphone in your browser, then try again.',
    unsupported: 'This browser cannot do the live check. Use a recent Chrome, Safari, Edge or Firefox.',
  },
};

const ERR: Record<Locale, Record<string, string>> = {
  fr: {
    phone_invalid: 'Ce numéro n’est pas valide.',
    phone_country_not_supported: 'Seuls les numéros du Canada et des États-Unis sont acceptés.',
    phone_not_mobile: 'Utilisez un numéro de cellulaire (pas un numéro Internet ou fixe).',
    email_invalid: 'Ce courriel n’est pas valide.',
    email_disposable: 'Les courriels jetables ne sont pas acceptés.',
    code_invalid: 'Code incorrect.',
    code_expired: 'Ce code a expiré. Demandez-en un nouveau.',
    code_missing: 'Demandez d’abord un code.',
    too_many_attempts: 'Trop d’essais. Recommencez plus tard.',
    too_many_codes: 'Trop de codes demandés. Réessayez dans quelques minutes.',
    resend_too_soon: 'Attendez 30 secondes avant de redemander un code.',
    send_failed: 'Envoi impossible pour le moment. Réessayez.',
    automation_detected: 'Navigateur automatisé ou caméra virtuelle détecté. Utilisez votre propre appareil et sa vraie caméra.',
    recording_too_short: 'L’enregistrement est trop court. Gardez la page ouverte jusqu’à la fin.',
    clock_mismatch: 'L’enregistrement n’est pas valide. Réessayez.',
    multiple_faces: 'Plus d’un visage détecté. Soyez seul devant la caméra.',
    face_not_visible: 'Votre visage n’était pas assez visible. Plus de lumière, visage dans l’ovale.',
    head_moves_wrong: 'Les mouvements de tête ne correspondent pas. Faites des mouvements plus marqués, dans l’ordre affiché.',
    not_enough_frontal_frames: 'Regardez bien la caméra entre chaque mouvement.',
    face_changed: 'Le visage a changé pendant la vérification.',
    spoof_suspected: 'Ce visage ne semble pas réel (photo ou écran). Utilisez votre vrai visage.',
    no_audio: 'Aucun son reçu. Vérifiez le micro.',
    bad_audio: 'Le son n’a pas pu être lu. Réessayez.',
    no_voice: 'Nous n’avons pas entendu votre voix. Dites les chiffres clairement, à voix haute.',
    mouth_not_moving: 'Votre bouche doit bouger quand vous parlez. Parlez face à la caméra.',
    voice_not_in_sync: 'La voix ne correspond pas aux mouvements de la bouche.',
    digits_wrong: 'Les chiffres entendus ne correspondent pas. Dites-les clairement, un à la fois.',
    speech_error: 'Analyse de la voix impossible pour le moment. Réessayez.',
    speech_unavailable: 'Analyse de la voix indisponible. Réessayez plus tard.',
    challenge_invalid: 'Ce défi a expiré. Réessayez.',
    id_face_not_found: 'Aucune photo de visage trouvée sur la carte.',
    id_looks_like_selfie: 'Montrez la pièce d’identité, pas votre visage.',
    id_too_far: 'Rapprochez la carte : elle doit remplir le cadre.',
    id_multiple_faces: 'Une seule carte dans l’image, personne d’autre.',
    id_text_not_found: 'Le texte de la carte n’est pas lisible. Évitez les reflets et le flou.',
    id_expired: 'Cette pièce d’identité est expirée.',
    id_replay_suspected: 'Cette image ne semble pas être une vraie pièce d’identité.',
    id_match_uncertain: 'Comparaison incertaine. Reprenez une photo plus nette de la carte.',
    id_face_mismatch: 'Le visage de la carte ne correspond pas au vôtre.',
    id_image_unreadable: 'Image illisible. Reprenez la photo.',
    image_invalid: 'Image invalide. Reprenez la photo.',
    liveness_required: 'Faites d’abord la vérification en direct.',
    session_expired: 'Cette vérification a expiré.',
    session_failed: 'Cette vérification a échoué.',
    session_missing: 'Session introuvable. Retournez au site pour recommencer.',
    csrf_invalid: 'Session invalide. Rechargez la page.',
    wrong_step: 'Étape déjà faite ou pas encore disponible. Rechargez la page.',
    invalid_input: 'Entrée invalide.',
    file_too_large: 'Fichier trop gros.',
    server_error: 'Erreur du serveur. Réessayez.',
    network: 'Connexion impossible. Vérifiez Internet et réessayez.',
  },
  en: {
    phone_invalid: 'This number is not valid.',
    phone_country_not_supported: 'Only Canadian and US numbers are accepted.',
    phone_not_mobile: 'Use a mobile number (not an Internet or landline number).',
    email_invalid: 'This email is not valid.',
    email_disposable: 'Throwaway email addresses are not accepted.',
    code_invalid: 'Wrong code.',
    code_expired: 'This code expired. Ask for a new one.',
    code_missing: 'Ask for a code first.',
    too_many_attempts: 'Too many attempts. Try again later.',
    too_many_codes: 'Too many codes requested. Try again in a few minutes.',
    resend_too_soon: 'Wait 30 seconds before asking for a new code.',
    send_failed: 'Could not send right now. Try again.',
    automation_detected: 'Automated browser or virtual camera detected. Use your own device and its real camera.',
    recording_too_short: 'The recording is too short. Keep the page open until the end.',
    clock_mismatch: 'The recording is not valid. Try again.',
    multiple_faces: 'More than one face detected. Be alone in front of the camera.',
    face_not_visible: 'Your face was not visible enough. More light, face in the oval.',
    head_moves_wrong: 'The head moves do not match. Make bigger moves, in the order shown.',
    not_enough_frontal_frames: 'Look straight at the camera between moves.',
    face_changed: 'The face changed during the check.',
    spoof_suspected: 'This face does not look real (photo or screen). Use your real face.',
    no_audio: 'No sound received. Check the microphone.',
    bad_audio: 'The sound could not be read. Try again.',
    no_voice: 'We did not hear your voice. Say the numbers clearly, out loud.',
    mouth_not_moving: 'Your mouth must move when you speak. Speak facing the camera.',
    voice_not_in_sync: 'The voice does not match the mouth movements.',
    digits_wrong: 'The numbers heard do not match. Say them clearly, one at a time.',
    speech_error: 'Voice analysis is not possible right now. Try again.',
    speech_unavailable: 'Voice analysis unavailable. Try again later.',
    challenge_invalid: 'This challenge expired. Try again.',
    id_face_not_found: 'No face photo found on the card.',
    id_looks_like_selfie: 'Show the ID card, not your face.',
    id_too_far: 'Move the card closer: it must fill the frame.',
    id_multiple_faces: 'Only one card in the picture, nobody else.',
    id_text_not_found: 'The card text is not readable. Avoid glare and blur.',
    id_expired: 'This ID is expired.',
    id_replay_suspected: 'This image does not look like a real ID.',
    id_match_uncertain: 'Comparison uncertain. Take a sharper photo of the card.',
    id_face_mismatch: 'The face on the card does not match yours.',
    id_image_unreadable: 'Unreadable image. Take the photo again.',
    image_invalid: 'Invalid image. Take the photo again.',
    liveness_required: 'Do the live check first.',
    session_expired: 'This verification expired.',
    session_failed: 'This verification failed.',
    session_missing: 'Session not found. Go back to the site to start again.',
    csrf_invalid: 'Invalid session. Reload the page.',
    wrong_step: 'Step already done or not available yet. Reload the page.',
    invalid_input: 'Invalid input.',
    file_too_large: 'File too large.',
    server_error: 'Server error. Try again.',
    network: 'Cannot connect. Check your Internet and try again.',
  },
};

// ---------------------------------------------------------------------------------------------------
const app = document.getElementById('app') as HTMLElement;
const langBtn = document.getElementById('lang') as HTMLButtonElement;
let state: FlowState;
let locale: Locale = 'fr';
const t = () => STR[locale];
const errText = (code: string) => ERR[locale][code] ?? ERR[locale].server_error!;

// Human-interaction signals (counts only, no content).
const loadedAt = performance.now();
let pointerEvents = 0;
let keyEvents = 0;
addEventListener('pointerdown', () => pointerEvents++, { passive: true });
addEventListener('keydown', () => keyEvents++, { passive: true });
const deviceLabels = { videoLabel: '', audioLabel: '' };

function signals() {
  return {
    webdriver: navigator.webdriver === true,
    languages: [...(navigator.languages ?? [])].slice(0, 10),
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    pointerEvents,
    keyEvents,
    msOnPage: Math.round(performance.now() - loadedAt),
    hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
    screen: { w: screen.width, h: screen.height },
    ...(deviceLabels.videoLabel ? { videoLabel: deviceLabels.videoLabel.slice(0, 200) } : {}),
    ...(deviceLabels.audioLabel ? { audioLabel: deviceLabels.audioLabel.slice(0, 200) } : {}),
  };
}

class ApiError extends Error {
  constructor(public code: string, public data: Record<string, unknown>) {
    super(code);
  }
}

async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? { 'x-liveid-csrf': state?.csrf ?? '' } : { 'content-type': 'application/json', 'x-liveid-csrf': state?.csrf ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(json.error ?? 'server_error'), json);
  return json as T;
}

async function upload<T = Record<string, unknown>>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'x-liveid-csrf': state.csrf }, body: form });
  } catch {
    throw new ApiError('network', {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(json.error ?? 'server_error'), json);
  return json as T;
}

// Tiny DOM builder: text always goes through textContent (no HTML injection).
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function screenOf(...children: Child[]) {
  app.replaceChildren(progress(), ...children.filter(Boolean).map((c) => (typeof c === 'string' ? document.createTextNode(c) : (c as Node))));
}

function progress(): HTMLElement {
  const steps = state?.steps ?? [];
  return h('ol', { class: 'steps', 'aria-hidden': 'true' }, ...steps.map((s) => h('li', { class: s.done ? 'done' : s.step === state.next ? 'now' : '' })));
}

function errorBox(code: string): HTMLElement {
  return h('div', { class: 'error', role: 'alert' }, errText(code));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------
async function refresh(): Promise<void> {
  state = await api<FlowState>('/api/flow/state');
  render();
}

function render(): void {
  document.documentElement.lang = locale;
  langBtn.textContent = t().lang;
  if (state.status === 'completed') return renderEnd(t().completedAlready);
  if (state.status === 'expired') return renderEnd(t().expired);
  if (state.status === 'denied') return renderEnd(t().denied);
  if (state.status === 'failed') return renderFailed();
  switch (state.next) {
    case 'consent':
      return renderConsent();
    case 'phone':
      return renderContact('sms');
    case 'email':
      return renderContact('email');
    case 'liveness':
      return renderLiveIntro();
    case 'id_document':
      return renderIdIntro();
    case 'done':
      return renderDone();
  }
}

function renderConsent(err?: string): void {
  const name = state.client.name;
  const labels: Record<Step, string> = { consent: '', phone: t().s_phone, email: t().s_email, liveness: t().s_liveness, id_document: t().s_id };
  const items = state.steps.filter((s) => s.step !== 'consent').map((s, i) => h('li', {}, h('span', { class: 'num' }, String(i + 1)), h('span', {}, labels[s.step])));
  const box = h('input', { type: 'checkbox', id: 'agree' }) as HTMLInputElement;
  const accept = h('button', { class: 'btn', type: 'button', disabled: true }, t().accept) as HTMLButtonElement;
  box.addEventListener('change', () => (accept.disabled = !box.checked));
  accept.addEventListener('click', async () => {
    accept.disabled = true;
    try {
      await api('/api/flow/consent', { accept: true, signals: signals() });
      await refresh();
    } catch (e) {
      renderConsent((e as ApiError).code);
    }
  });
  const refuse = h('button', { class: 'btn secondary', type: 'button' }, t().refuse);
  refuse.addEventListener('click', async () => {
    const r = await api<{ redirect?: string }>('/api/flow/consent', { accept: false }).catch(() => ({ redirect: undefined }));
    await leave(r.redirect, 'access_denied');
  });
  screenOf(
    h('p', { class: 'eyebrow' }, 'TAKATAK LIVE ID'),
    h('h1', {}, t().wants(name)),
    h('p', {}, t().intro),
    err ? errorBox(err) : null,
    h('h2', {}, t().willCheck),
    h('ul', { class: 'list' }, ...items),
    h('div', { class: 'notice' }, t().privacy),
    h('label', { class: 'check', for: 'agree' }, box, h('span', {}, t().consentBox(name))),
    h('div', { class: 'actions' }, accept, refuse),
  );
}

function renderContact(channel: 'sms' | 'email', err?: string): void {
  const isSms = channel === 'sms';
  const input = h('input', {
    class: 'text',
    id: 'contact',
    type: isSms ? 'tel' : 'email',
    autocomplete: isSms ? 'tel' : 'email',
    inputmode: isSms ? 'tel' : 'email',
    placeholder: isSms ? '514 555-0123' : 'nom@exemple.ca',
    required: true,
  }) as HTMLInputElement;
  const send = h('button', { class: 'btn', type: 'submit' }, t().sendCode) as HTMLButtonElement;
  const form = h(
    'form',
    {},
    h('label', { class: 'field', for: 'contact' }, isSms ? t().phoneLabel : t().emailLabel),
    input,
    h('div', { class: 'actions' }, send),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    send.disabled = true;
    try {
      const r = await api<{ to: string }>(isSms ? '/api/flow/phone/start' : '/api/flow/email/start', isSms ? { phone: input.value } : { email: input.value });
      renderCode(channel, r.to);
    } catch (e) {
      renderContact(channel, (e as ApiError).code);
    }
  });
  screenOf(
    h('p', { class: 'eyebrow' }, isSms ? '1 · SMS' : '2 · COURRIEL / EMAIL'),
    h('h1', {}, isSms ? t().phoneTitle : t().emailTitle),
    h('p', { class: 'muted' }, isSms ? t().phoneHelp : t().emailHelp),
    err ? errorBox(err) : null,
    form,
  );
  input.focus();
}

function renderCode(channel: 'sms' | 'email', to: string, err?: string): void {
  const isSms = channel === 'sms';
  const input = h('input', {
    class: 'text code',
    id: 'code',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    maxlength: '6',
    pattern: '[0-9]{6}',
    required: true,
  }) as HTMLInputElement;
  const go = h('button', { class: 'btn', type: 'submit' }, t().verify) as HTMLButtonElement;
  const form = h('form', {}, h('label', { class: 'field', for: 'code' }, t().codeLabel), input, h('div', { class: 'actions' }, go));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    go.disabled = true;
    try {
      await api(isSms ? '/api/flow/phone/verify' : '/api/flow/email/verify', { code: input.value.trim() });
      await refresh();
    } catch (e) {
      renderCode(channel, to, (e as ApiError).code);
    }
  });
  const resend = h('button', { class: 'link', type: 'button' }, t().resend);
  resend.addEventListener('click', () => renderContact(channel));
  screenOf(
    h('h1', {}, t().codeTitle),
    h('p', { class: 'muted' }, t().codeSentTo(to)),
    err ? errorBox(err) : null,
    form,
    resend,
  );
  input.focus();
  // WebOTP: on Android Chrome the code from our SMS fills in by itself (bound to our domain).
  if (isSms && 'OTPCredential' in window) {
    const ac = new AbortController();
    form.addEventListener('submit', () => ac.abort());
    (navigator.credentials as unknown as { get(o: unknown): Promise<{ code?: string } | null> })
      .get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((c) => {
        if (c?.code) {
          input.value = c.code;
          form.requestSubmit();
        }
      })
      .catch(() => undefined);
  }
}

// ---- Live check -------------------------------------------------------------------------------------
let liveStream: MediaStream | null = null;

function stopStream(): void {
  liveStream?.getTracks().forEach((tr) => tr.stop());
  liveStream = null;
}

function renderLiveIntro(err?: string, left?: number): void {
  stopStream();
  const start = h('button', { class: 'btn', type: 'button' }, t().startCamera) as HTMLButtonElement;
  start.addEventListener('click', () => void startLive());
  screenOf(
    h('p', { class: 'eyebrow' }, '3 · LIVE'),
    h('h1', {}, t().liveTitle),
    err ? errorBox(err) : null,
    left !== undefined ? h('p', { class: 'muted small' }, t().attemptsLeft(left)) : null,
    h('p', {}, t().liveHelp),
    h('p', { class: 'muted small' }, t().liveSayLang),
    h('div', { class: 'actions' }, start),
  );
}

async function startLive(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return renderEnd(t().unsupported);
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
  } catch {
    renderLiveIntro();
    return showInline(t().needCamera);
  }
  deviceLabels.videoLabel = liveStream.getVideoTracks()[0]?.label ?? '';
  deviceLabels.audioLabel = liveStream.getAudioTracks()[0]?.label ?? '';

  const video = h('video', { class: 'mirror', autoplay: true, muted: true, playsinline: true }) as HTMLVideoElement;
  video.muted = true;
  video.srcObject = liveStream;
  const stage = h('div', { class: 'stage' }, video, h('div', { class: 'oval' }));
  const ready = h('button', { class: 'btn', type: 'button' }, t().ready) as HTMLButtonElement;
  screenOf(h('h1', {}, t().liveTitle), stage, h('p', { class: 'muted small' }, t().liveSayLang), h('div', { class: 'actions' }, ready));
  await video.play().catch(() => undefined);
  ready.addEventListener('click', () => void runChallenge(video, stage, ready));
}

function showInline(msg: string): void {
  app.append(h('div', { class: 'error', role: 'alert' }, msg));
}

async function runChallenge(video: HTMLVideoElement, stage: HTMLElement, ready: HTMLButtonElement): Promise<void> {
  ready.remove();
  let ch: Challenge;
  try {
    ch = await api<Challenge>('/api/flow/liveness/challenge', { signals: signals() });
  } catch (e) {
    const code = (e as ApiError).code;
    stopStream();
    if (code === 'automation_detected' || code === 'too_many_attempts') return refresh().then(() => showInline(errText(code)));
    return renderLiveIntro(code);
  }

  const bar = h('div', { class: 'bar' }, h('div', {}));
  stage.after(bar);
  const count = h('div', { class: 'count' }, '3');
  stage.append(count);
  for (const n of ['3', '2', '1']) {
    count.textContent = n;
    await sleep(700);
  }
  count.remove();

  // Audio: raw samples through an AudioWorklet (same-origin module, allowed by the CSP).
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('/assets/pcm-worklet.js');
  const source = ctx.createMediaStreamSource(liveStream!);
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume();
  const chunks: Float32Array[] = [];
  node.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);

  // Frames: what the camera sees (NOT mirrored), small JPEGs.
  const canvas = document.createElement('canvas');
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.min(1, 480 / vw);
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const g = canvas.getContext('2d')!;
  const frames: Array<{ t: number; blob: Promise<Blob | null> }> = [];

  const prompt = h('div', { class: 'prompt' });
  const rec = h('div', { class: 'rec' }, t().rec);
  stage.append(prompt, rec);
  const plan = ch.plan;
  const total = plan.speakMs + ch.moves.length * (plan.moveMs + plan.centerMs);
  const words = ch.digits.split('').join('  ');

  const t0 = performance.now();
  node.port.postMessage('start');
  const frameTimer = setInterval(() => {
    const now = performance.now() - t0;
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({ t: Math.round(now), blob: new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8)) });
  }, Math.round(1000 / plan.fps));

  const arrows: Record<Move, string> = { left: '←', right: '→', up: '↑', down: '↓' };
  const fill = bar.firstElementChild as HTMLElement;
  for (;;) {
    const now = performance.now() - t0;
    if (now >= total) break;
    fill.style.width = `${Math.min(100, (now / total) * 100)}%`;
    let content: HTMLElement[];
    if (now < plan.speakMs) {
      content = [h('div', { class: 'say' }, t().say), h('div', { class: 'big' }, words)];
    } else {
      const k = now - plan.speakMs;
      const i = Math.floor(k / (plan.moveMs + plan.centerMs));
      const inMove = k - i * (plan.moveMs + plan.centerMs) < plan.moveMs;
      const mv = ch.moves[i]!;
      content = inMove ? [h('div', { class: 'arrow' }, arrows[mv]), h('div', { class: 'say' }, t().turn[mv])] : [h('div', { class: 'say' }, t().center)];
    }
    prompt.replaceChildren(...content);
    await sleep(100);
  }
  clearInterval(frameTimer);
  node.port.postMessage('stop');
  await sleep(150);
  source.disconnect();
  node.disconnect();
  const rate = ctx.sampleRate;
  await ctx.close();
  fill.style.width = '100%';
  rec.remove();
  prompt.replaceChildren(h('div', { class: 'say' }, t().analyzing));
  stopStream();

  const wav = encodeWav(resample(concat(chunks), rate, 16000), 16000);
  const blobs = await Promise.all(frames.map((f) => f.blob));
  const form = new FormData();
  form.append('challengeId', ch.challengeId);
  const kept = frames.filter((_, i) => blobs[i]);
  form.append('meta', JSON.stringify({ frames: kept.map((f) => f.t), speakWindow: { start: 0, end: plan.speakMs }, signals: signals() }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  blobs.forEach((b, i) => b && form.append('frame', b, `f${i}.jpg`));

  screenOf(h('h1', {}, t().liveTitle), h('div', { class: 'spinner' }), h('p', { class: 'muted', style: 'text-align:center' }, t().analyzing));
  try {
    const r = await upload<{ passed: boolean; reasons: string[]; attemptsLeft: number }>('/api/flow/liveness/submit', form);
    if (r.passed) {
      screenOf(h('div', { class: 'success' }, t().livePassed));
      await sleep(900);
      return refresh();
    }
    if (r.attemptsLeft <= 0) return refresh();
    return renderLiveIntro(r.reasons[0] ?? 'server_error', r.attemptsLeft);
  } catch (e) {
    const code = (e as ApiError).code;
    if (code === 'automation_detected' || code === 'too_many_attempts') return refresh().then(() => showInline(errText(code)));
    return renderLiveIntro(code);
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Linear-interpolation resampler with a simple moving-average anti-alias pre-filter. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const win = Math.max(1, Math.round(ratio));
  const filtered = new Float32Array(input.length);
  let acc = 0;
  for (let i = 0; i < input.length; i++) {
    acc += input[i]!;
    if (i >= win) acc -= input[i - win]!;
    filtered[i] = acc / Math.min(i + 1, win);
  }
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const a = Math.floor(x);
    const b = Math.min(a + 1, filtered.length - 1);
    out[i] = filtered[a]! + (filtered[b]! - filtered[a]!) * (x - a);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

// ---- ID front ---------------------------------------------------------------------------------------
function renderIdIntro(err?: string, left?: number): void {
  stopStream();
  const open = h('button', { class: 'btn', type: 'button' }, t().openCamera) as HTMLButtonElement;
  open.addEventListener('click', () => void startIdCamera());
  screenOf(
    h('p', { class: 'eyebrow' }, '4 · ID'),
    h('h1', {}, t().idTitle),
    err ? errorBox(err) : null,
    left !== undefined ? h('p', { class: 'muted small' }, t().attemptsLeft(left)) : null,
    h('p', {}, t().idHelp),
    h('div', { class: 'actions' }, open),
  );
}

async function startIdCamera(): Promise<void> {
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch {
    renderIdIntro();
    return showInline(t().needCamera);
  }
  deviceLabels.videoLabel = liveStream.getVideoTracks()[0]?.label ?? deviceLabels.videoLabel;
  const video = h('video', { autoplay: true, muted: true, playsinline: true }) as HTMLVideoElement;
  video.muted = true;
  video.srcObject = liveStream;
  const stage = h('div', { class: 'stage' }, video, h('div', { class: 'cardframe' }));
  const shoot = h('button', { class: 'btn', type: 'button' }, t().capture) as HTMLButtonElement;
  screenOf(h('h1', {}, t().idTitle), stage, h('p', { class: 'muted small' }, t().idHelp), h('div', { class: 'actions' }, shoot));
  await video.play().catch(() => undefined);
  shoot.addEventListener('click', async () => {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
    stopStream();
    if (!blob) return renderIdIntro('image_invalid');
    renderIdPreview(blob);
  });
}

function renderIdPreview(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const send = h('button', { class: 'btn', type: 'button' }, t().usePhoto) as HTMLButtonElement;
  const again = h('button', { class: 'btn secondary', type: 'button' }, t().retake);
  again.addEventListener('click', () => {
    URL.revokeObjectURL(url);
    void startIdCamera();
  });
  send.addEventListener('click', async () => {
    send.disabled = true;
    const form = new FormData();
    form.append('image', blob, 'id-front.jpg');
    screenOf(h('h1', {}, t().idTitle), h('div', { class: 'spinner' }), h('p', { class: 'muted', style: 'text-align:center' }, t().analyzing));
    try {
      const r = await upload<{ passed: boolean; reason: string | null; attemptsLeft: number }>('/api/flow/id/submit', form);
      URL.revokeObjectURL(url);
      if (r.passed) {
        screenOf(h('div', { class: 'success' }, t().idPassed));
        await sleep(900);
        return refresh();
      }
      if (r.attemptsLeft <= 0) return refresh();
      return renderIdIntro(r.reason ?? 'server_error', r.attemptsLeft);
    } catch (e) {
      return renderIdIntro((e as ApiError).code);
    }
  });
  screenOf(h('h1', {}, t().idTitle), h('img', { class: 'shot', src: url, alt: '' }), h('div', { class: 'actions' }, send, again));
}

// ---- End ---------------------------------------------------------------------------------------------
function renderDone(): void {
  const go = h('button', { class: 'btn', type: 'button' }, t().continue) as HTMLButtonElement;
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const r = await api<{ mode: string; redirect?: string; targetOrigin?: string; code?: string; state?: string; fallback?: string }>('/api/flow/finish', {});
      if (r.mode === 'popup' && window.opener && r.targetOrigin) {
        (window.opener as Window).postMessage({ type: 'liveid:result', code: r.code, state: r.state }, r.targetOrigin);
        window.close();
        return;
      }
      location.assign(r.redirect ?? r.fallback!);
    } catch (e) {
      go.disabled = false;
      showInline(errText((e as ApiError).code));
    }
  });
  screenOf(h('p', { class: 'eyebrow' }, 'TAKATAK LIVE ID'), h('h1', {}, t().doneTitle), h('div', { class: 'success' }, t().doneText(state.client.name)), h('div', { class: 'actions' }, go));
}

function renderFailed(): void {
  const back = h('button', { class: 'btn secondary', type: 'button' }, t().back);
  back.addEventListener('click', () => void cancelAndLeave());
  screenOf(h('h1', {}, t().failedTitle), h('p', {}, t().failedText), h('div', { class: 'actions' }, back));
}

function renderEnd(message: string): void {
  stopStream();
  const back = h('button', { class: 'btn secondary', type: 'button' }, t().back);
  back.addEventListener('click', () => void cancelAndLeave());
  screenOf(h('p', {}, message), state && state.status !== 'completed' ? h('div', { class: 'actions' }, back) : null);
}

async function cancelAndLeave(): Promise<void> {
  const r = await api<{ mode: string; redirect?: string; fallback?: string; targetOrigin?: string; error?: string; state?: string }>('/api/flow/cancel', {}).catch(() => null);
  if (!r) return;
  if (r.mode === 'popup' && window.opener && r.targetOrigin) {
    (window.opener as Window).postMessage({ type: 'liveid:result', error: r.error, state: r.state }, r.targetOrigin);
    window.close();
    return;
  }
  location.assign(r.redirect ?? r.fallback!);
}

async function leave(url: string | undefined, error: string): Promise<void> {
  if (state.display === 'popup' && window.opener) {
    window.close();
    return;
  }
  if (url) location.assign(url);
  else renderEnd(error === 'access_denied' ? t().denied : t().failedText);
}

// ---- Boot --------------------------------------------------------------------------------------------
langBtn.addEventListener('click', () => {
  locale = locale === 'fr' ? 'en' : 'fr';
  if (state) render();
});

(async () => {
  try {
    state = await api<FlowState>('/api/flow/state');
    locale = state.locale;
    render();
  } catch (e) {
    app.replaceChildren(h('p', {}, errText((e as ApiError).code)));
  }
})();
