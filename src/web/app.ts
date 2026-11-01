/* TAKATAK LIVE ID — browser flow. It captures; it never decides. Every check is made on the server. */
import type { Box, Detector } from './detector.js';

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

// ---------------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------------
const STR = {
  fr: {
    lang: 'EN',
    stepLabels: { email: 'Courriel', phone: 'Cellulaire', consent: 'Conditions', liveness: 'Vidéo', id_document: 'Pièce' } as Record<Step, string>,
    wants: (n: string) => `${n} veut vérifier votre identité`,
    contactTitle: 'Vos coordonnées',
    contactLead: 'Un code à 6 chiffres pour chacun. Ça prend moins d’une minute.',
    emailLabel: 'Courriel',
    emailPlaceholder: 'nom@exemple.ca',
    phoneLabel: 'Cellulaire',
    phonePlaceholder: '514 555-0123',
    sendCode: 'Envoyer le code',
    sending: 'Envoi…',
    codeSentTo: (to: string) => `Code envoyé à ${to}`,
    resendIn: (s: number) => `Renvoyer dans ${s} s`,
    resend: 'Renvoyer le code',
    change: 'Modifier',
    verifying: 'Vérification…',
    verified: 'Vérifié',
    codeAria: (i: number) => `Chiffre ${i} du code`,
    notice: 'En continuant, vous acceptez de recevoir ces codes. Vos coordonnées sont chiffrées et servent seulement à cette vérification.',
    termsTitle: 'Dernière étape avant la vidéo',
    termsLead: 'Voici ce qui va se passer :',
    termsVideo: 'Vidéo de 20 secondes : dites 4 chiffres à voix haute, puis tournez la tête dans l’ordre affiché. Elle démarre toute seule quand votre visage est dans l’ovale.',
    termsId: 'Photo du recto de votre pièce d’identité : elle se prend toute seule quand la carte est dans le cadre.',
    termsPrivacy:
      'Vie privée : les images et le son sont analysés puis effacés aussitôt ; aucune photo n’est conservée et votre visage n’est stocké dans aucune banque. Le résultat envoyé au site dit seulement si la vérification a réussi.',
    acceptAll: (n: string) =>
      `J’accepte toutes les conditions : conditions d’utilisation, politique de confidentialité, et l’analyse de mon visage et de ma voix (données biométriques) par TAKATAK LIVE ID, seulement pour cette vérification demandée par ${n}.`,
    next: 'Suivant',
    acceptFinish: 'Accepter et terminer',
    refuse: 'Refuser',
    liveTitle: 'Vérification vidéo',
    startVideo: 'Démarrer la vidéo',
    cameraStarting: 'Ouverture de la caméra…',
    guide: {
      loading: 'Préparation…',
      none: 'Placez votre visage dans l’ovale',
      many: 'Une seule personne devant la caméra',
      far: 'Approchez-vous un peu',
      near: 'Reculez un peu',
      off: 'Centrez votre visage dans l’ovale',
      hold: 'Parfait, ne bougez plus…',
    },
    say: 'Dites à voix haute :',
    turn: { left: 'Tournez la tête à GAUCHE', right: 'Tournez la tête à DROITE', up: 'Levez la tête vers le HAUT', down: 'Baissez la tête vers le BAS' } as Record<Move, string>,
    center: 'Revenez face à la caméra',
    completed: 'Complété ✓',
    notEnough: 'Pas assez — recommencez, allez plus loin',
    movesFailed: 'Les mouvements n’étaient pas assez marqués. On recommence : tournez franchement la tête jusqu’à ce que la flèche soit verte.',
    rec: 'ENREGISTREMENT',
    analyzing: 'Analyse en cours…',
    livePassed: 'Vidéo vérifiée',
    tryAgain: 'Réessayer',
    attemptsLeft: (n: number) => `Essais restants : ${n}`,
    ready: 'Je suis prêt',
    idTitle: 'Recto de votre pièce d’identité',
    idGuide: {
      loading: 'Ouverture de la caméra…',
      place: 'Placez le recto de la carte dans le cadre',
      closer: 'Rapprochez la carte',
      farther: 'Éloignez un peu la carte',
      blur: 'Image floue : tenez la carte immobile',
      dark: 'Plus de lumière, s’il vous plaît',
      glare: 'Reflet sur la carte : inclinez-la légèrement',
      hold: 'Parfait, ne bougez plus…',
      captured: 'Photo prise',
    },
    idHelp: 'Permis de conduire, carte d’assurance maladie avec photo ou passeport. Recto seulement.',
    manual: 'Prendre la photo',
    idPassed: 'Pièce vérifiée : c’est bien vous',
    doneTitle: 'Identité vérifiée',
    doneText: (n: string) => `Merci ! Retour vers ${n}…`,
    continue: 'Continuer',
    failedTitle: 'Vérification impossible',
    failedText: 'La vérification n’a pas pu être complétée. Retournez au site pour recommencer plus tard.',
    back: 'Retourner au site',
    expired: 'Cette vérification a expiré. Retournez au site pour recommencer.',
    denied: 'Vérification refusée.',
    completedAlready: 'Cette vérification est déjà terminée.',
    needCamera: 'Autorisez la caméra et le micro dans votre navigateur, puis réessayez.',
    unsupported: 'Ce navigateur ne permet pas la vérification vidéo. Utilisez Chrome, Safari, Edge ou Firefox récent.',
    secure: 'Connexion chiffrée · Données effacées après analyse',
  },
  en: {
    lang: 'FR',
    stepLabels: { email: 'Email', phone: 'Mobile', consent: 'Terms', liveness: 'Video', id_document: 'ID' } as Record<Step, string>,
    wants: (n: string) => `${n} wants to verify your identity`,
    contactTitle: 'Your contact details',
    contactLead: 'One 6-digit code for each. It takes less than a minute.',
    emailLabel: 'Email',
    emailPlaceholder: 'name@example.com',
    phoneLabel: 'Mobile',
    phonePlaceholder: '514 555-0123',
    sendCode: 'Send code',
    sending: 'Sending…',
    codeSentTo: (to: string) => `Code sent to ${to}`,
    resendIn: (s: number) => `Resend in ${s} s`,
    resend: 'Resend code',
    change: 'Change',
    verifying: 'Checking…',
    verified: 'Verified',
    codeAria: (i: number) => `Code digit ${i}`,
    notice: 'By continuing you agree to receive these codes. Your details are encrypted and used only for this verification.',
    termsTitle: 'Last step before the video',
    termsLead: 'Here is what happens next:',
    termsVideo: '20-second video: say 4 numbers out loud, then turn your head in the order shown. It starts by itself when your face is in the oval.',
    termsId: 'Photo of the front of your ID: it is taken by itself when the card is in the frame.',
    termsPrivacy:
      'Privacy: images and sound are analysed and deleted right away; no photo is kept and your face is not stored in any database. The site only learns whether the verification passed.',
    acceptAll: (n: string) =>
      `I accept all the terms: terms of use, privacy policy, and the analysis of my face and voice (biometric data) by TAKATAK LIVE ID, only for this verification requested by ${n}.`,
    next: 'Next',
    acceptFinish: 'Accept and finish',
    refuse: 'Refuse',
    liveTitle: 'Video check',
    startVideo: 'Start the video',
    cameraStarting: 'Opening the camera…',
    guide: {
      loading: 'Getting ready…',
      none: 'Put your face in the oval',
      many: 'Only one person in front of the camera',
      far: 'Come a little closer',
      near: 'Move back a little',
      off: 'Centre your face in the oval',
      hold: 'Perfect, hold still…',
    },
    say: 'Say out loud:',
    turn: { left: 'Turn your head LEFT', right: 'Turn your head RIGHT', up: 'Tilt your head UP', down: 'Tilt your head DOWN' } as Record<Move, string>,
    center: 'Back to facing the camera',
    completed: 'Completed ✓',
    notEnough: 'Not enough — try again, go further',
    movesFailed: 'The moves were not big enough. Let’s start again: turn your head clearly until the arrow turns green.',
    rec: 'RECORDING',
    analyzing: 'Analysing…',
    livePassed: 'Video verified',
    tryAgain: 'Try again',
    attemptsLeft: (n: number) => `Attempts left: ${n}`,
    ready: 'I’m ready',
    idTitle: 'Front of your ID',
    idGuide: {
      loading: 'Opening the camera…',
      place: 'Put the front of the card in the frame',
      closer: 'Bring the card closer',
      farther: 'Move the card back a little',
      blur: 'Blurry: hold the card still',
      dark: 'More light, please',
      glare: 'Glare on the card: tilt it slightly',
      hold: 'Perfect, hold still…',
      captured: 'Photo taken',
    },
    idHelp: 'Driver’s licence, health card with photo, or passport. Front only.',
    manual: 'Take photo',
    idPassed: 'ID verified: it is you',
    doneTitle: 'Identity verified',
    doneText: (n: string) => `Thank you! Returning to ${n}…`,
    continue: 'Continue',
    failedTitle: 'Verification not possible',
    failedText: 'The verification could not be completed. Go back to the site to try again later.',
    back: 'Back to the site',
    expired: 'This verification expired. Go back to the site to start again.',
    denied: 'Verification refused.',
    completedAlready: 'This verification is already complete.',
    needCamera: 'Allow the camera and microphone in your browser, then try again.',
    unsupported: 'This browser cannot do the video check. Use a recent Chrome, Safari, Edge or Firefox.',
    secure: 'Encrypted connection · Data deleted after analysis',
  },
};

const ERR: Record<Locale, Record<string, string>> = {
  fr: {
    phone_invalid: 'Ce numéro n’est pas valide.',
    phone_country_not_supported: 'Seuls les numéros du Canada et des États-Unis sont acceptés.',
    phone_not_mobile: 'Utilisez un numéro de cellulaire (pas un numéro Internet ou fixe).',
    email_invalid: 'Ce courriel n’est pas valide.',
    email_disposable: 'Les courriels jetables ne sont pas acceptés.',
    code_invalid: 'Code incorrect. Réessayez.',
    code_expired: 'Ce code a expiré. Renvoyez-en un nouveau.',
    code_missing: 'Envoyez d’abord un code.',
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
    id_match_uncertain: 'Comparaison incertaine. Tenez la carte plus près et immobile.',
    id_face_mismatch: 'Le visage de la carte ne correspond pas au vôtre.',
    id_image_unreadable: 'Image illisible. On reprend.',
    image_invalid: 'Image invalide. On reprend.',
    liveness_required: 'Faites d’abord la vidéo.',
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
    code_invalid: 'Wrong code. Try again.',
    code_expired: 'This code expired. Send a new one.',
    code_missing: 'Send a code first.',
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
    id_match_uncertain: 'Comparison uncertain. Hold the card closer and still.',
    id_face_mismatch: 'The face on the card does not match yours.',
    id_image_unreadable: 'Unreadable image. Trying again.',
    image_invalid: 'Invalid image. Trying again.',
    liveness_required: 'Do the video first.',
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
// Plumbing
// ---------------------------------------------------------------------------------------------------
const app = document.getElementById('app') as HTMLElement;
const langBtn = document.getElementById('lang') as HTMLButtonElement;
let state: FlowState;
let locale: Locale = 'fr';
const t = () => STR[locale];
const errText = (code: string) => ERR[locale][code] ?? ERR[locale].server_error!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const vibrate = (ms: number) => navigator.vibrate?.(ms);

// Human-interaction signals (counts only, never content).
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
  constructor(
    public code: string,
    public data: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError('network', {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(json.error ?? 'server_error'), json);
  return json as T;
}

function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-liveid-csrf': state?.csrf ?? '' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return send<T>(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function upload<T = Record<string, unknown>>(path: string, form: FormData): Promise<T> {
  return send<T>(path, { method: 'POST', headers: { 'x-liveid-csrf': state.csrf }, body: form });
}

// Tiny DOM builder. Text always goes through text nodes (no HTML injection); no inline style attributes (CSP).
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

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number>, ...children: Element[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

function checkIcon(cls = 'icon-check'): SVGElement {
  return svg('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' }, svg('path', { d: 'M5 12.5l4.2 4.2L19 7' }));
}

function stepper(): HTMLElement {
  const steps = state?.steps ?? [];
  return h(
    'ol',
    { class: 'stepper', 'aria-label': 'Étapes' },
    ...steps.map((s, i) =>
      h(
        'li',
        { class: s.done ? 'done' : s.step === state.next ? 'now' : '', 'aria-current': s.step === state.next ? 'step' : undefined },
        h('span', { class: 'dot' }, s.done ? checkIcon() : String(i + 1)),
        h('span', { class: 'label' }, t().stepLabels[s.step]),
      ),
    ),
  );
}

let currentScreen = '';
function show(id: string, ...children: Child[]): void {
  const animate = currentScreen !== id;
  currentScreen = id;
  app.replaceChildren(stepper(), ...children.filter(Boolean).map((c) => (typeof c === 'string' ? document.createTextNode(c) : (c as Node))));
  if (animate) {
    app.classList.remove('enter');
    void app.offsetWidth; // restart the CSS animation
    app.classList.add('enter');
  }
}

function errorBox(code: string): HTMLElement {
  return h('div', { class: 'alert error', role: 'alert' }, errText(code));
}

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
    case 'email':
    case 'phone':
      return renderContact();
    case 'consent':
      return renderTerms();
    case 'liveness':
      return renderLive();
    case 'id_document':
      return renderId();
    case 'done':
      return renderDone();
  }
}

// ---------------------------------------------------------------------------------------------------
// 1–2. Email, then mobile — one screen, code boxes appear right below, checked at the 6th digit
// ---------------------------------------------------------------------------------------------------
function renderContact(): void {
  const kinds = state.steps.filter((s) => s.step === 'email' || s.step === 'phone').map((s) => s.step as 'email' | 'phone');
  const sections = kinds.map((k) => contactSection(k));
  show(
    'contact',
    h('p', { class: 'eyebrow' }, t().wants(state.client.name)),
    h('h1', {}, t().contactTitle),
    h('p', { class: 'muted' }, t().contactLead),
    ...sections.map((s) => s.el),
    h('p', { class: 'fine' }, t().notice),
  );
  sections.find((s) => s.kind === state.next)?.activate();
}

function contactSection(kind: 'email' | 'phone') {
  const isEmail = kind === 'email';
  const done = state.steps.find((s) => s.step === kind)?.done ?? false;
  const masked = isEmail ? state.email : state.phone;
  const title = h('div', { class: 'sec-title' }, h('span', { class: 'sec-dot' }, done ? checkIcon() : isEmail ? '@' : '#'), h('span', {}, isEmail ? t().emailLabel : t().phoneLabel));
  const status = h('span', { class: 'sec-status' }, done ? `${masked ?? ''} · ${t().verified}` : '');
  const body = h('div', { class: 'sec-body' });
  const el = h('section', { class: `sec ${done ? 'is-done' : 'is-waiting'}` }, h('div', { class: 'sec-head' }, title, status), body);

  const activate = () => {
    el.className = 'sec is-active';
    const input = h('input', {
      class: 'field-input',
      id: `in-${kind}`,
      type: isEmail ? 'email' : 'tel',
      autocomplete: isEmail ? 'email' : 'tel',
      inputmode: isEmail ? 'email' : 'tel',
      placeholder: isEmail ? t().emailPlaceholder : t().phonePlaceholder,
      'aria-label': isEmail ? t().emailLabel : t().phoneLabel,
      enterkeyhint: 'send',
    }) as HTMLInputElement;
    const sendBtn = h('button', { class: 'btn btn-inline', type: 'submit' }, t().sendCode) as HTMLButtonElement;
    const msg = h('div', { class: 'sec-msg', 'aria-live': 'polite' });
    const codeArea = h('div', { class: 'code-area' });
    let resendTimer: ReturnType<typeof setInterval> | undefined;
    const form = h('form', { class: 'input-group', novalidate: true }, input, sendBtn);
    body.replaceChildren(form, msg, codeArea);
    input.focus();

    const sendCode = async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = t().sending;
      msg.replaceChildren();
      try {
        const r = await api<{ to: string; resendIn: number }>(isEmail ? '/api/flow/email/start' : '/api/flow/phone/start', isEmail ? { email: input.value, signals: signals() } : { phone: input.value, signals: signals() });
        input.readOnly = true;
        form.classList.add('is-sent');
        sendBtn.textContent = t().change;
        sendBtn.disabled = false;
        sendBtn.onclick = (ev) => {
          ev.preventDefault();
          clearInterval(resendTimer);
          input.readOnly = false;
          form.classList.remove('is-sent');
          codeArea.replaceChildren();
          sendBtn.textContent = t().sendCode;
          sendBtn.onclick = null;
          input.focus();
          input.select();
        };
        showCodeBoxes(r.to, r.resendIn);
      } catch (e) {
        sendBtn.disabled = false;
        sendBtn.textContent = t().sendCode;
        msg.replaceChildren(errorBox((e as ApiError).code));
        if ((e as ApiError).code === 'automation_detected') return void refresh().catch(() => undefined);
        input.focus();
      }
    };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!input.readOnly) void sendCode();
    });

    function showCodeBoxes(to: string, resendIn: number) {
      const boxes = Array.from({ length: 6 }, (_, i) =>
        h('input', {
          class: 'otp',
          type: 'text',
          inputmode: 'numeric',
          pattern: '[0-9]*',
          maxlength: i === 0 ? '6' : '1',
          autocomplete: i === 0 ? 'one-time-code' : 'off',
          'aria-label': t().codeAria(i + 1),
        }) as HTMLInputElement,
      );
      const row = h('div', { class: 'otp-row' }, ...boxes);
      const info = h('div', { class: 'code-info' }, h('span', {}, t().codeSentTo(to)));
      const resend = h('button', { class: 'link', type: 'button', disabled: true }, t().resendIn(resendIn)) as HTMLButtonElement;
      info.append(resend);
      const codeMsg = h('div', { class: 'sec-msg', 'aria-live': 'polite' });
      codeArea.replaceChildren(row, info, codeMsg);
      boxes[0]!.focus();

      let left = resendIn;
      clearInterval(resendTimer);
      const timer = setInterval(() => {
        left--;
        if (left <= 0) {
          clearInterval(timer);
          resend.disabled = false;
          resend.textContent = t().resend;
        } else resend.textContent = t().resendIn(left);
      }, 1000);
      resendTimer = timer;
      resend.addEventListener('click', () => {
        clearInterval(timer);
        void sendCode();
      });

      let busy = false;
      const value = () => boxes.map((b) => b.value).join('');
      const fill = (digits: string, from = 0) => {
        const d = digits.replace(/\D/g, '').slice(0, 6 - from);
        [...d].forEach((c, i) => (boxes[from + i]!.value = c));
        boxes[Math.min(5, from + d.length)]!.focus();
      };
      const check = async () => {
        const code = value();
        if (code.length !== 6 || busy) return;
        busy = true;
        row.classList.add('is-busy');
        codeMsg.replaceChildren(h('span', { class: 'muted small' }, t().verifying));
        try {
          await api(isEmail ? '/api/flow/email/verify' : '/api/flow/phone/verify', { code });
          clearInterval(timer);
          row.classList.add('is-ok');
          vibrate(20);
          await sleep(450);
          await refresh();
        } catch (e) {
          busy = false;
          row.classList.remove('is-busy');
          row.classList.add('is-bad');
          setTimeout(() => row.classList.remove('is-bad'), 500);
          codeMsg.replaceChildren(errorBox((e as ApiError).code));
          boxes.forEach((b) => (b.value = ''));
          boxes[0]!.focus();
        }
      };
      boxes.forEach((b, i) => {
        b.addEventListener('input', () => {
          if (b.value.length > 1) {
            const v = b.value;
            b.value = '';
            fill(v, i);
          } else if (b.value && !/\d/.test(b.value)) b.value = '';
          else if (b.value && i < 5) boxes[i + 1]!.focus();
          void check();
        });
        b.addEventListener('keydown', (ev) => {
          if (ev.key === 'Backspace' && !b.value && i > 0) boxes[i - 1]!.focus();
        });
        b.addEventListener('paste', (ev) => {
          ev.preventDefault();
          fill(ev.clipboardData?.getData('text') ?? '', i);
          void check();
        });
      });

      // Android Chrome: the code from our SMS fills in by itself (WebOTP, bound to our domain).
      if (!isEmail && 'OTPCredential' in window) {
        const ac = new AbortController();
        (navigator.credentials as unknown as { get(o: unknown): Promise<{ code?: string } | null> })
          .get({ otp: { transport: ['sms'] }, signal: ac.signal })
          .then((c) => {
            if (c?.code) {
              fill(c.code);
              void check();
            }
          })
          .catch(() => undefined);
      }
    }
  };

  return { kind, el, activate };
}

// ---------------------------------------------------------------------------------------------------
// 3. Accept all the terms → Next → the video starts
// ---------------------------------------------------------------------------------------------------
let audioCtx: AudioContext | null = null;

function renderTerms(err?: string): void {
  const name = state.client.name;
  const hasVideo = state.steps.some((s) => s.step === 'liveness');
  const hasId = state.steps.some((s) => s.step === 'id_document');
  const box = h('input', { type: 'checkbox', id: 'agree' }) as HTMLInputElement;
  const next = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, hasVideo ? t().next : t().acceptFinish) as HTMLButtonElement;
  box.addEventListener('change', () => (next.disabled = !box.checked));
  next.addEventListener('click', async () => {
    next.disabled = true;
    // Created inside the click: browsers only allow sound capture to start from a tap.
    if (hasVideo && !audioCtx && typeof AudioContext !== 'undefined') {
      audioCtx = new AudioContext();
      void audioCtx.resume();
    }
    try {
      await api('/api/flow/consent', { accept: true, signals: signals() });
      await refresh();
    } catch (e) {
      renderTerms((e as ApiError).code);
    }
  });
  const refuse = h('button', { class: 'link', type: 'button' }, t().refuse);
  refuse.addEventListener('click', async () => {
    const r = await api<{ redirect?: string }>('/api/flow/consent', { accept: false }).catch(() => ({ redirect: undefined }));
    await leave(r.redirect);
  });
  // Start fetching the face detector now, so the camera is ready the moment "Next" is tapped.
  if (hasVideo) void loadDetector();
  const items: HTMLElement[] = [];
  if (hasVideo) items.push(h('li', {}, h('span', { class: 'num' }, '1'), h('span', {}, t().termsVideo)));
  if (hasId) items.push(h('li', {}, h('span', { class: 'num' }, '2'), h('span', {}, t().termsId)));
  show(
    'terms',
    h('p', { class: 'eyebrow' }, 'TAKATAK LIVE ID'),
    h('h1', {}, hasVideo ? t().termsTitle : t().wants(name)),
    err ? errorBox(err) : null,
    items.length ? h('p', { class: 'muted' }, t().termsLead) : null,
    items.length ? h('ul', { class: 'list' }, ...items) : null,
    h('div', { class: 'notice' }, t().termsPrivacy),
    h('label', { class: 'check', for: 'agree' }, box, h('span', {}, t().acceptAll(name))),
    h('div', { class: 'actions' }, next),
    h('div', { class: 'center' }, refuse),
  );
}

// ---------------------------------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------------------------------
let stream: MediaStream | null = null;
let detectorPromise: Promise<Detector | null> | null = null;
let qualityFn: ((v: HTMLVideoElement, r: { x: number; y: number; w: number; h: number }) => { sharpness: number; brightness: number; glare: number }) | null = null;

function stopStream(): void {
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
}

function loadDetector(): Promise<Detector | null> {
  // Loaded on demand: the detector file is large, the first screens do not need it.
  detectorPromise ??= import('./detector.js')
    .then((m) => {
      qualityFn = m.imageQuality;
      return m.createDetector();
    })
    .catch(() => null);
  return detectorPromise;
}

/** Where a video pixel lands inside its element (object-fit: cover, optional mirror). */
function videoToStage(video: HTMLVideoElement, b: Box, mirror: boolean) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const sw = video.clientWidth || 1;
  const sh = video.clientHeight || 1;
  const k = Math.max(sw / vw, sh / vh);
  const ox = (vw * k - sw) / 2;
  const oy = (vh * k - sh) / 2;
  let x = b.x * k - ox;
  const y = b.y * k - oy;
  const w = b.w * k;
  const hh = b.h * k;
  if (mirror) x = sw - (x + w);
  return { x: x / sw, y: y / sh, w: w / sw, h: hh / sh };
}

/** The stage rectangle (fractions of the element) expressed in video pixels. */
function stageToVideo(video: HTMLVideoElement, r: { x: number; y: number; w: number; h: number }) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const sw = video.clientWidth || 1;
  const sh = video.clientHeight || 1;
  const k = Math.max(sw / vw, sh / vh);
  const ox = (vw * k - sw) / 2;
  const oy = (vh * k - sh) / 2;
  return { x: (r.x * sw + ox) / k, y: (r.y * sh + oy) / k, w: (r.w * sw) / k, h: (r.h * sh) / k };
}

/** Face oval, as fractions of the 3:4 face stage. The SVG below draws exactly this ellipse. */
const OVAL = { cx: 0.5, cy: 0.5, rx: 0.34, ry: 0.4 };

function ovalRing(): { el: SVGElement; progress: (f: number) => void } {
  // viewBox 75 × 100 = the 3:4 stage, so the ring, the .oval-hole mask and the face maths line up exactly.
  const W = 75;
  const H = 100;
  const cx = OVAL.cx * W;
  const cy = OVAL.cy * H;
  const rx = OVAL.rx * W;
  const ry = OVAL.ry * H;
  const track = svg('ellipse', { cx, cy, rx, ry, class: 'ring-track' });
  const bar = svg('ellipse', { cx, cy, rx, ry, class: 'ring-bar', pathLength: 100, transform: `rotate(-90 ${cx} ${cy})` });
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ring', 'aria-hidden': 'true' }, track, bar);
  return { el, progress: (f) => bar.setAttribute('stroke-dashoffset', String(100 - Math.max(0, Math.min(1, f)) * 100)) };
}

// ---------------------------------------------------------------------------------------------------
// 4. Video check — starts by itself when the face is in the oval
// ---------------------------------------------------------------------------------------------------
function renderLive(err?: string, left?: number): void {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') return renderEnd(t().unsupported);
  void loadDetector();
  if (!audioCtx) {
    // Arrived here without the "Next" tap (page reloaded): one tap is needed to allow sound capture.
    const start = h('button', { class: 'btn btn-primary', type: 'button' }, t().startVideo);
    start.addEventListener('click', () => {
      audioCtx = new AudioContext();
      void audioCtx.resume();
      renderLive(err, left);
    });
    return show('live-gate', h('h1', {}, t().liveTitle), err ? errorBox(err) : null, left !== undefined ? h('p', { class: 'muted small' }, t().attemptsLeft(left)) : null, h('p', {}, t().termsVideo), h('div', { class: 'actions' }, start));
  }

  const video = h('video', { class: 'mirror', autoplay: true, muted: true, playsinline: true }) as HTMLVideoElement;
  video.muted = true;
  const ring = ovalRing();
  const pill = h('div', { class: 'pill' }, t().cameraStarting);
  const overlay = h('div', { class: 'overlay' });
  const stage = h('div', { class: 'stage stage-face' }, video, h('div', { class: 'oval-hole' }), ring.el, overlay, pill);
  const below = h('div', { class: 'below' });
  show('live', h('h1', {}, t().liveTitle), err ? errorBox(err) : null, left !== undefined ? h('p', { class: 'muted small' }, t().attemptsLeft(left)) : null, stage, below);

  void (async () => {
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
        });
      } catch {
        pill.textContent = t().needCamera;
        pill.classList.add('bad');
        const again = h('button', { class: 'btn btn-primary', type: 'button' }, t().tryAgain);
        again.addEventListener('click', () => renderLive());
        below.replaceChildren(h('div', { class: 'actions' }, again));
        return;
      }
    }
    deviceLabels.videoLabel = stream.getVideoTracks()[0]?.label ?? '';
    deviceLabels.audioLabel = stream.getAudioTracks()[0]?.label ?? '';
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    try {
      await waitForFace(video, stage, pill, below);
      await runChallenge(video, stage, ring, pill, overlay, below);
    } catch {
      // The person left this screen (language switch, navigation): nothing to do.
    }
  })();
}

/** Resolves when one face sits well inside the oval, at a good size, for about one second. */
async function waitForFace(video: HTMLVideoElement, stage: HTMLElement, pill: HTMLElement, below: HTMLElement): Promise<void> {
  pill.textContent = t().guide.loading;
  const detector = await loadDetector();
  if (!detector) {
    // No in-browser detector: fall back to a button.
    pill.textContent = t().guide.none;
    const ready = h('button', { class: 'btn btn-primary', type: 'button' }, t().ready);
    below.replaceChildren(h('div', { class: 'actions' }, ready));
    await new Promise<void>((r) => ready.addEventListener('click', () => r(), { once: true }));
    below.replaceChildren();
    return;
  }
  let good = 0;
  for (;;) {
    if (!document.body.contains(video)) throw new Error('left');
    let faces: Box[] = [];
    try {
      faces = (await detector.faces(video)).filter((f) => f.score >= 0.6);
    } catch {
      faces = [];
    }
    let key: keyof ReturnType<typeof t>['guide'] = 'none';
    if (faces.length > 1) key = 'many';
    else if (faces.length === 1) {
      const f = videoToStage(video, faces[0]!, true);
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      const off = ((cx - OVAL.cx) / OVAL.rx) ** 2 + ((cy - OVAL.cy) / OVAL.ry) ** 2;
      const size = f.w / (2 * OVAL.rx); // face width / oval width
      // Tight face outline vs oval width: a well-framed face fills about 60–90 % of the oval.
      if (size < 0.45) key = 'far';
      else if (size > 1.05) key = 'near';
      else if (off > 0.25) key = 'off';
      else key = 'hold';
    }
    good = key === 'hold' ? good + 1 : 0;
    pill.textContent = t().guide[key];
    stage.classList.toggle('is-ok', key === 'hold');
    if (good >= 8) return;
    await sleep(110);
  }
}

const ARROWS: Record<Move, string> = { left: '←', right: '→', up: '↑', down: '↓' };
/** Required head turn, a little beyond the server's own threshold so the server surely sees it. */
const NEED = { yaw: 0.24, pitch: 0.11 };
const MOVE_HOLD_MS = 500;
const MOVE_TRIES = 2;
/** Whole recording cap (the server accepts up to 220 frames at 5 per second). */
const MAX_RECORDING_MS = 40_000;
const FALLBACK_MOVE_MS = 2200;

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 0..1: how far the head went toward the asked direction (camera view: nose to image-right = person's left). */
function moveProgress(mv: Move, dx: number, dy: number): number {
  const v = mv === 'left' ? dx / NEED.yaw : mv === 'right' ? -dx / NEED.yaw : mv === 'up' ? -dy / NEED.pitch : dy / NEED.pitch;
  return Math.max(0, Math.min(1, v));
}

async function facePose(detector: Detector, video: HTMLVideoElement): Promise<{ nx: number; ny: number } | null> {
  try {
    const faces = (await detector.faces(video)).filter((f) => f.score >= 0.5);
    return faces.length === 1 && faces[0]!.pose ? faces[0]!.pose : null;
  } catch {
    return null;
  }
}

/** Big direction arrow that fills from its tail to its tip as the head turns. */
function arrowGauge(mv: Move): { el: HTMLElement; set: (f: number, mode: 'live' | 'ok' | 'bad') => void } {
  const fill = h('span', { class: 'gauge-fill' }, ARROWS[mv]);
  const el = h('div', { class: `gauge gauge-${mv}` }, h('span', { class: 'gauge-base' }, ARROWS[mv]), fill);
  return {
    el,
    set(f, mode) {
      const pct = `${Math.round((1 - f) * 100)}%`;
      // CSSOM changes are allowed by the CSP (no inline style attribute is written).
      fill.style.clipPath =
        mv === 'left' ? `inset(0 0 0 ${pct})` : mv === 'right' ? `inset(0 ${pct} 0 0)` : mv === 'up' ? `inset(${pct} 0 0 0)` : `inset(0 0 ${pct} 0)`;
      el.classList.toggle('is-ok', mode === 'ok');
      el.classList.toggle('is-bad', mode === 'bad');
    },
  };
}

async function runChallenge(video: HTMLVideoElement, stage: HTMLElement, ring: ReturnType<typeof ovalRing>, pill: HTMLElement, overlay: HTMLElement, below: HTMLElement): Promise<void> {
  let ch: Challenge;
  try {
    ch = await api<Challenge>('/api/flow/liveness/challenge', { signals: signals() });
  } catch (e) {
    return liveFailed((e as ApiError).code);
  }
  stage.classList.remove('is-ok');
  pill.classList.add('hidden');
  for (const n of ['3', '2', '1']) {
    overlay.replaceChildren(h('div', { class: 'count' }, n));
    await sleep(650);
  }
  overlay.replaceChildren();

  // Sound: raw samples through an AudioWorklet (same-origin module, allowed by the CSP).
  const ctx = audioCtx!;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  await ctx.audioWorklet.addModule('/assets/pcm-worklet.js').catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream!);
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);
  const chunks: Float32Array[] = [];
  node.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);

  // Frames: what the camera sees (NOT mirrored), small JPEGs.
  const canvas = document.createElement('canvas');
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.min(1, 480 / Math.max(vw, vh));
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const g = canvas.getContext('2d')!;
  const frames: Array<{ t: number; blob: Promise<Blob | null> }> = [];
  const plan = ch.plan;
  const prompt = h('div', { class: 'prompt' });
  const rec = h('div', { class: 'rec' }, h('span', { class: 'rec-dot' }), t().rec);
  const chips = h('div', { class: 'moves' }, ...ch.moves.map((m) => h('span', { class: 'move-chip' }, ARROWS[m])));
  stage.classList.add('is-rec');
  stage.append(prompt, rec);

  const t0 = performance.now();
  node.port.postMessage('start');
  const frameTimer = setInterval(() => {
    const now = performance.now() - t0;
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({ t: Math.round(now), blob: new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8)) });
  }, Math.round(1000 / plan.fps));

  // a) Digits, read aloud. Meanwhile the browser learns this person's straight-ahead pose.
  const detector = await loadDetector();
  prompt.replaceChildren(h('div', { class: 'say' }, t().say), h('div', { class: 'digits' }, ...ch.digits.split('').map((d) => h('span', {}, d))));
  const straight: Array<{ nx: number; ny: number }> = [];
  while (performance.now() - t0 < plan.speakMs) {
    ring.progress((performance.now() - t0) / plan.speakMs / 3);
    if (detector) {
      const p = await facePose(detector, video);
      if (p) straight.push(p);
    }
    await sleep(detector ? 60 : 100);
  }
  const base = straight.length >= 3 ? { nx: median(straight.map((p) => p.nx)), ny: median(straight.map((p) => p.ny)) } : null;

  // b) Head moves, one at a time. With live feedback when the browser can measure the head:
  //    the arrow fills in green as the head turns, "Completed" once far enough, red "Not enough" if not.
  let aborted = false;
  for (let i = 0; i < ch.moves.length && !aborted; i++) {
    if (performance.now() - t0 > MAX_RECORDING_MS) {
      aborted = true;
      break;
    }
    const mv = ch.moves[i]!;
    chips.children[i]?.classList.add('now');
    const gauge = arrowGauge(mv);
    const label = h('div', { class: 'say' }, t().turn[mv]);
    prompt.replaceChildren(chips, gauge.el, label);
    if (detector && base) {
      let done = false;
      for (let tries = 0; tries < MOVE_TRIES && !done; tries++) {
        gauge.set(0, 'live');
        label.textContent = t().turn[mv];
        const start = performance.now();
        let heldSince = 0;
        while (performance.now() - start < plan.moveMs) {
          const p = await facePose(detector, video);
          const f = p ? moveProgress(mv, p.nx - base.nx, p.ny - base.ny) : 0;
          gauge.set(f, 'live');
          if (f >= 1) {
            heldSince ||= performance.now();
            // Held long enough for the server to see it on at least 2 frames.
            if (performance.now() - heldSince >= MOVE_HOLD_MS) {
              done = true;
              break;
            }
          } else heldSince = 0;
          await sleep(40);
        }
        if (!done) {
          gauge.set(1, 'bad');
          label.textContent = t().notEnough;
          vibrate(60);
          await sleep(1100);
        }
      }
      if (!done) {
        aborted = true;
        break;
      }
      gauge.set(1, 'ok');
      label.textContent = t().completed;
      chips.children[i]?.classList.replace('now', 'done');
      vibrate(15);
      await sleep(450);
      // Back to the centre before the next move (the server needs straight-ahead frames between moves).
      label.textContent = t().center;
      const back = performance.now();
      while (performance.now() - back < 2500) {
        const p = await facePose(detector, video);
        if (p && Math.abs(p.nx - base.nx) < 0.08 && Math.abs(p.ny - base.ny) < 0.05 && performance.now() - back >= plan.centerMs) break;
        await sleep(60);
      }
    } else {
      // No live measure available: a fixed rhythm, still checked by the server.
      await sleep(FALLBACK_MOVE_MS);
      chips.children[i]?.classList.replace('now', 'done');
      label.textContent = t().center;
      await sleep(900);
    }
    ring.progress(1 / 3 + ((i + 1) / ch.moves.length) * (2 / 3));
  }
  clearInterval(frameTimer);
  node.port.postMessage('stop');
  await sleep(150);
  source.disconnect();
  node.disconnect();
  ring.progress(1);
  rec.remove();
  prompt.remove();
  stage.classList.remove('is-rec');
  if (aborted) {
    // Not uploaded, so no attempt is used: the person simply starts again with a new challenge.
    ring.progress(0);
    pill.classList.remove('hidden');
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, t().tryAgain);
    below.replaceChildren(h('div', { class: 'alert error', role: 'alert' }, t().movesFailed), h('div', { class: 'actions' }, again));
    again.addEventListener('click', async () => {
      below.replaceChildren();
      try {
        await waitForFace(video, stage, pill, below);
        await runChallenge(video, stage, ring, pill, overlay, below);
      } catch {
        // left the screen
      }
    });
    return;
  }
  overlay.replaceChildren(h('div', { class: 'busy' }, h('div', { class: 'spinner' }), h('div', {}, t().analyzing)));

  const wav = encodeWav(resample(concat(chunks), ctx.sampleRate, 16000), 16000);
  const blobs = await Promise.all(frames.map((f) => f.blob));
  const form = new FormData();
  form.append('challengeId', ch.challengeId);
  const kept = frames.filter((_, i) => blobs[i]);
  form.append('meta', JSON.stringify({ frames: kept.map((f) => f.t), speakWindow: { start: 0, end: plan.speakMs }, signals: signals() }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
  blobs.forEach((b, i) => b && form.append('frame', b, `f${i}.jpg`));

  try {
    const r = await upload<{ passed: boolean; reasons: string[]; attemptsLeft: number }>('/api/flow/liveness/submit', form);
    if (r.passed) {
      stopStream();
      vibrate(30);
      overlay.replaceChildren(h('div', { class: 'busy ok' }, checkIcon('icon-big'), h('div', {}, t().livePassed)));
      await sleep(900);
      return refresh();
    }
    if (r.attemptsLeft <= 0) {
      stopStream();
      return refresh();
    }
    overlay.replaceChildren();
    ring.progress(0);
    pill.classList.remove('hidden');
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, t().tryAgain);
    below.replaceChildren(errorBox(r.reasons[0] ?? 'server_error'), h('p', { class: 'muted small center' }, t().attemptsLeft(r.attemptsLeft)), h('div', { class: 'actions' }, again));
    again.addEventListener('click', async () => {
      below.replaceChildren();
      try {
        await waitForFace(video, stage, pill, below);
        await runChallenge(video, stage, ring, pill, overlay, below);
      } catch {
        // left the screen
      }
    });
  } catch (e) {
    return liveFailed((e as ApiError).code);
  }
}

function liveFailed(code: string): void {
  stopStream();
  if (code === 'automation_detected' || code === 'too_many_attempts' || code.startsWith('session_')) {
    void refresh().then(() => app.append(errorBox(code)));
    return;
  }
  renderLive(code);
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

/** Linear-interpolation resampler with a moving-average anti-alias pre-filter. */
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

// ---------------------------------------------------------------------------------------------------
// 5. ID front — photo taken and sent by itself when the card is in the frame, sharp and still
// ---------------------------------------------------------------------------------------------------
/** The card frame, as fractions of the stage (must match .cardframe in styles.css). */
const CARD = { x: 0.07, y: 0.14, w: 0.86, h: 0.72 };
const ID_SHARPNESS_MIN = 18;

function renderId(err?: string, left?: number): void {
  if (!navigator.mediaDevices?.getUserMedia) return renderEnd(t().unsupported);
  void loadDetector();
  const video = h('video', { autoplay: true, muted: true, playsinline: true }) as HTMLVideoElement;
  video.muted = true;
  const pill = h('div', { class: 'pill' }, t().idGuide.loading);
  const overlay = h('div', { class: 'overlay' });
  const frame = h('div', { class: 'cardframe' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }));
  const stage = h('div', { class: 'stage stage-card' }, video, frame, overlay, pill);
  const msg = h('div', { class: 'below' }, err ? errorBox(err) : null, left !== undefined ? h('p', { class: 'muted small center' }, t().attemptsLeft(left)) : null);
  const manual = h('button', { class: 'btn btn-ghost hidden', type: 'button' }, t().manual) as HTMLButtonElement;
  show('id', h('h1', {}, t().idTitle), h('p', { class: 'muted' }, t().idHelp), stage, msg, h('div', { class: 'actions' }, manual));

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch {
      pill.textContent = t().needCamera;
      pill.classList.add('bad');
      return;
    }
    deviceLabels.videoLabel = stream.getVideoTracks()[0]?.label ?? deviceLabels.videoLabel;
    const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
    if (facing === 'user') video.classList.add('mirror');
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    let taken = false;
    const take = async () => {
      if (taken) return;
      taken = true;
      const blob = await snapshot(video);
      vibrate(40);
      stage.classList.add('flash');
      pill.textContent = t().idGuide.captured;
      overlay.replaceChildren(h('div', { class: 'busy' }, h('div', { class: 'spinner' }), h('div', {}, t().analyzing)));
      stopStream();
      if (!blob) return renderId('image_invalid');
      const form = new FormData();
      form.append('image', blob, 'id-front.jpg');
      try {
        const r = await upload<{ passed: boolean; reason: string | null; attemptsLeft: number }>('/api/flow/id/submit', form);
        if (r.passed) {
          overlay.replaceChildren(h('div', { class: 'busy ok' }, checkIcon('icon-big'), h('div', {}, t().idPassed)));
          await sleep(1000);
          return refresh();
        }
        if (r.attemptsLeft <= 0) return refresh();
        return renderId(r.reason ?? 'server_error', r.attemptsLeft);
      } catch (e) {
        const code = (e as ApiError).code;
        if (code.startsWith('session_') || code === 'too_many_attempts') return refresh();
        return renderId(code);
      }
    };
    manual.addEventListener('click', () => void take());
    setTimeout(() => manual.classList.remove('hidden'), 8000);

    const detector = await loadDetector();
    if (!detector) {
      manual.classList.remove('hidden');
      pill.textContent = t().idGuide.place;
      return;
    }
    let good = 0;
    let last: { x: number; y: number } | null = null;
    while (!taken && document.body.contains(video)) {
      let key: keyof ReturnType<typeof t>['idGuide'] = 'place';
      try {
        const mirror = video.classList.contains('mirror');
        const faces = (await detector.faces(video)).map((f) => ({ f, s: videoToStage(video, f, mirror) }));
        const inCard = faces.filter(({ s }) => {
          const cx = s.x + s.w / 2;
          const cy = s.y + s.h / 2;
          return cx > CARD.x && cx < CARD.x + CARD.w && cy > CARD.y && cy < CARD.y + CARD.h;
        });
        if (inCard.length) {
          const main = inCard.sort((a, b) => b.s.w - a.s.w)[0]!;
          const rel = main.s.w / CARD.w; // face photo (tight outline) width / card frame width
          if (rel > 0.45) key = 'farther';
          else if (rel < 0.07) key = 'closer';
          else {
            const q = imageQualityOf(video);
            if (q.brightness < 45) key = 'dark';
            else if (q.glare > 0.08) key = 'glare';
            else if (q.sharpness < ID_SHARPNESS_MIN) key = 'blur';
            else {
              const c = { x: main.s.x + main.s.w / 2, y: main.s.y + main.s.h / 2 };
              const still = last ? Math.hypot(c.x - last.x, c.y - last.y) < 0.02 : false;
              last = c;
              key = still ? 'hold' : 'blur';
            }
          }
        } else last = null;
      } catch {
        key = 'place';
      }
      good = key === 'hold' ? good + 1 : 0;
      pill.textContent = t().idGuide[key];
      stage.classList.toggle('is-ok', key === 'hold');
      if (good >= 4) {
        await take();
        return;
      }
      await sleep(180);
    }
  })();
}

function imageQualityOf(video: HTMLVideoElement) {
  if (!qualityFn) return { sharpness: 999, brightness: 128, glare: 0 };
  return qualityFn(video, stageToVideo(video, CARD));
}

async function snapshot(video: HTMLVideoElement): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

// ---------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------
function renderDone(): void {
  const go = h('button', { class: 'btn btn-primary', type: 'button' }, t().continue) as HTMLButtonElement;
  let gone = false;
  const finish = async () => {
    if (gone) return;
    gone = true;
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
      gone = false;
      go.disabled = false;
      app.append(errorBox((e as ApiError).code));
    }
  };
  go.addEventListener('click', () => void finish());
  show(
    'done',
    h('div', { class: 'done-mark' }, checkIcon('icon-big')),
    h('h1', { class: 'center' }, t().doneTitle),
    h('p', { class: 'muted center' }, t().doneText(state.client.name)),
    h('div', { class: 'actions' }, go),
  );
  setTimeout(() => void finish(), 1800);
}

function renderFailed(): void {
  stopStream();
  const back = h('button', { class: 'btn btn-ghost', type: 'button' }, t().back);
  back.addEventListener('click', () => void cancelAndLeave());
  show('failed', h('h1', {}, t().failedTitle), h('p', {}, t().failedText), h('div', { class: 'actions' }, back));
}

function renderEnd(message: string): void {
  stopStream();
  const back = h('button', { class: 'btn btn-ghost', type: 'button' }, t().back);
  back.addEventListener('click', () => void cancelAndLeave());
  show('end', h('p', {}, message), state && state.status !== 'completed' ? h('div', { class: 'actions' }, back) : null);
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

async function leave(url: string | undefined): Promise<void> {
  if (state.display === 'popup' && window.opener) {
    window.close();
    return;
  }
  if (url) location.assign(url);
  else renderEnd(t().denied);
}

// ---------------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------------
langBtn.addEventListener('click', () => {
  locale = locale === 'fr' ? 'en' : 'fr';
  langBtn.textContent = t().lang;
  document.documentElement.lang = locale;
  // Re-render only screens without a running camera or a half-typed code.
  if (state && (currentScreen === 'terms' || currentScreen === 'done' || currentScreen === 'end' || currentScreen === 'failed')) render();
});

const footer = document.querySelector('.foot-secure');
if (footer) footer.textContent = '';

(async () => {
  try {
    state = await api<FlowState>('/api/flow/state');
    locale = state.locale;
    if (footer) footer.textContent = t().secure;
    render();
  } catch (e) {
    app.replaceChildren(h('p', {}, errText((e as ApiError).code)));
  }
})();
