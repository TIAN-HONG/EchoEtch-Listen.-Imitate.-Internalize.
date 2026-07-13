let sentence = "It's not as easy as it looks.";
const stepContent = {
  1: ["STEP 01 · INPUT", "先别看答案，只用耳朵", "完整听 2–3 遍，把你听见的内容写下来。不确定的地方也先留下猜测。"],
  2: ["STEP 02 · NOTICE", "对比差异，弄懂为什么", "检查听错和漏听的位置，把新词、句型、连读和语法变成可复用的知识。"],
  3: ["STEP 03 · REVIEW", "带着理解，再听一遍", "现在你知道每个声音从哪里来。重听整句，感受语流如何自然地连起来。"],
  4: ["STEP 04 · IMITATE", "像影子一样贴住原声", "晚半拍开口，模仿说话者的速度、重音、情绪和语调，不要逐词朗读。"],
  5: ["STEP 05 · RETRIEVE", "脱离文本，用原速说出来", "把提示藏起来，连续三次在目标时间内完整背出，完成从输入到输出。"]
};
let currentStep = 1;
let listenCount = 0;
let blindRate = 1;
let timerInterval = null;
let recordStart = 0;
let successCount = 0;
let mediaRecorder = null;
let mediaChunks = [];
let uploadedAudioUrl = null;
let uploadedAudioFile = null;
let sentenceSegments = [];
let selectedSegmentIndex = -1;
let sourceLinkMode = 'none';
let sourceLinkUrl = '';
let playbackButton = null;
let playbackStopTimer = null;
let pendingMediaFile = null;
let ffmpegInstance = null;
let isOptimizingMedia = false;
let optimizationCancelled = false;
let currentLookupWord = '';
let currentLookupDefinition = '';
let translationRequestId = 0;
let currentCourseId = '';
let currentCourseTotal = 0;

const COURSE_CATALOG = {
  'van-jones-kind-of-ai': {
    total: 173,
    lessonPath: 'user-media/van-jones-kind-of-ai/lesson.json'
  }
};

const MAX_MEDIA_BYTES = 800 * 1024 * 1024;
const LARGE_MEDIA_BYTES = 200 * 1024 * 1024;
const OPTIMIZE_MEDIA_BYTES = 100 * 1024 * 1024;
const FFMPEG_PACKAGE_URL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd';
const FFMPEG_UTIL_URL = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd';
const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
const FUNCTION_WORDS = new Set('a an the this that these those i you he she it we they me him her us them my your his its our their mine yours hers ours theirs am is are was were be been being do does did have has had will would shall should can could may might must and but or nor so yet if because although though while when where who whom whose which what as than of to in on at by for from with about into over after before between through during without under again further then once here there all any both each few more most other some such no not only own same too very just'.split(' '));
const FUNCTION_CONTRACTIONS = new Set("i'm you're he's she's it's we're they're i've you've we've they've i'll you'll he'll she'll we'll they'll i'd you'd he'd she'd we'd they'd i'm you're isn't aren't wasn't weren't don't doesn't didn't can't couldn't won't wouldn't that's what's there's we're they've".split(' '));
const AUXILIARY_WORDS = new Set('am is are was were be been being do does did have has had will would shall should can could may might must'.split(' '));
const SUBJECT_PRONOUNS = new Set('i you he she it we they there who what'.split(' '));
const COMMON_VERBS = new Set('worry want talk think know feel look looks seem seems need needs come comes create creates build builds proceed proceeds evolve evolves risk risks call calls hold holds multiply multiplies use uses help helps put puts get gets make makes say says tell tells go goes grow grows become becomes mean means matter matters work works give gives take takes keep keeps try tries ask asks believe believes happen happens happen happening'.split(' '));

function isFunctionWord(word) {
  return FUNCTION_WORDS.has(word) || FUNCTION_CONTRACTIONS.has(word);
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function courseProgressKey(courseId) {
  return `echoetch-course-progress-${courseId}`;
}

function readCourseProgress(courseId) {
  try {
    const stored = JSON.parse(localStorage.getItem(courseProgressKey(courseId)) || '{}');
    return {
      lastIndex: Math.max(0, Number(stored.lastIndex) || 0),
      completed: Array.isArray(stored.completed) ? stored.completed.map(Number).filter(Number.isInteger) : []
    };
  } catch {
    return { lastIndex: 0, completed: [] };
  }
}

function saveCourseProgress(courseId, progress) {
  localStorage.setItem(courseProgressKey(courseId), JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }));
}

function updateCatalogProgress() {
  const courseId = 'van-jones-kind-of-ai';
  const total = COURSE_CATALOG[courseId].total;
  const progress = readCourseProgress(courseId);
  const completedCount = new Set(progress.completed.filter(index => index >= 0 && index < total)).size;
  const percent = Math.round(completedCount / total * 100);
  $('#catalogProgressText').textContent = completedCount ? `${completedCount} / ${total} 句已完成` : '尚未开始';
  $('#catalogProgressPercent').textContent = `${percent}%`;
  $('#catalogProgressValue').style.width = `${percent}%`;
  $('.catalog-progress-track').setAttribute('aria-valuenow', String(percent));
  $('#catalogCourseAction').innerHTML = `${completedCount || progress.lastIndex ? '继续学习' : '开始课程'} <span>→</span>`;
}

function updateLessonPosition() {
  if (!sentenceSegments.length || selectedSegmentIndex < 0) return;
  const total = currentCourseTotal || sentenceSegments.length;
  const position = Math.min(total, selectedSegmentIndex + 1);
  $('#lessonProgressLabel').textContent = `第 ${position} / ${total} 句`;
  $('#lessonProgressBar').style.width = `${position / total * 100}%`;
}

function buildWaves() {
  $$('.waveform').forEach((wave, group) => {
    if (wave.children.length) return;
    const count = group === 0 ? 74 : 48;
    for (let i = 0; i < count; i++) {
      const bar = document.createElement('i');
      const h = 8 + Math.abs(Math.sin(i * 1.9 + group) * 25) + (i % 7) * 1.2;
      bar.style.setProperty('--h', `${Math.min(34, h)}px`);
      wave.appendChild(bar);
    }
  });
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2200);
}

function goToStep(step, completePrevious = false, scroll = true) {
  currentStep = Number(step);
  $$('.step-tab').forEach(tab => {
    const tabStep = Number(tab.dataset.step);
    tab.classList.toggle('active', tabStep === currentStep);
    if (completePrevious && tabStep < currentStep) tab.classList.add('completed');
  });
  $$('.step-panel').forEach(panel => panel.classList.toggle('active', Number(panel.dataset.panel) === currentStep));
  const [kicker, title, desc] = stepContent[currentStep];
  $('#stepKicker').textContent = kicker;
  $('#stepTitle').textContent = title;
  $('#stepDesc').textContent = desc;
  $('#statusChip').textContent = currentStep === 5 ? '最终挑战' : '进行中';
  $('#stepProgressLabel').textContent = `步骤 ${currentStep} / 5`;
  if (scroll) $('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function speak(text = sentence, rate = 1, onend) {
  if (!('speechSynthesis' in window)) {
    showToast('当前浏览器不支持语音播放');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.pitch = 1;
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang.startsWith('en') && /Samantha|Google US|Natural|Jenny/i.test(v.name)) || voices.find(v => v.lang.startsWith('en'));
  if (preferred) utterance.voice = preferred;
  if (onend) utterance.onend = onend;
  speechSynthesis.speak(utterance);
}

function getSegment() {
  const audio = $('#sourceAudio');
  const start = Math.max(0, Number($('#segmentStart').value) || 0);
  const requestedEnd = Number($('#segmentEnd').value) || start + 8;
  const end = Math.min(audio.duration || requestedEnd, Math.max(start + .5, requestedEnd));
  return { start, end, duration: end - start };
}

function stopSourceAudio() {
  const audio = $('#sourceAudio');
  audio.pause();
  clearTimeout(playbackStopTimer);
  playbackButton?.classList.remove('is-playing');
  playbackButton = null;
}

function playLessonAudio(rate = 1, button = null, fallbackText = sentence) {
  const audio = $('#sourceAudio');
  if (!audio.src) {
    speak(fallbackText, rate);
    if (button) animateWave(button, 4500 / rate);
    return;
  }
  window.speechSynthesis?.cancel();
  stopSourceAudio();
  const segment = getSegment();
  audio.currentTime = segment.start;
  audio.playbackRate = rate;
  playbackButton = button;
  button?.classList.add('is-playing');
  audio.play().then(() => {
    if (button) animateWave(button, segment.duration * 1000 / rate);
    playbackStopTimer = setTimeout(stopSourceAudio, segment.duration * 1000 / rate + 80);
  }).catch(() => showToast('音频无法播放，请重新选择文件'));
}

function animateWave(button, duration = 4500) {
  const player = button.closest('.audio-player') || document;
  const bars = $$('.waveform i', player);
  bars.forEach(b => b.classList.remove('played'));
  button.classList.add('is-playing');
  let index = 0;
  const tick = Math.max(35, duration / bars.length);
  const interval = setInterval(() => {
    if (bars[index]) bars[index].classList.add('played');
    index++;
    if (index >= bars.length) {
      clearInterval(interval);
      button.classList.remove('is-playing');
    }
  }, tick);
}

function normalize(str) {
  return str.toLowerCase().replace(/[’']/g, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}
function similarity(a, b) {
  const aa = normalize(a), bb = normalize(b);
  if (!aa) return 0;
  const wordsA = aa.split(' '), wordsB = bb.split(' ');
  let matches = 0;
  const used = new Set();
  wordsA.forEach((word, i) => {
    if (wordsB[i] === word && !used.has(i)) { matches += 1; used.add(i); return; }
    const idx = wordsB.findIndex((w, j) => w === word && !used.has(j));
    if (idx >= 0) { matches += .65; used.add(idx); }
  });
  return Math.round(Math.min(100, matches / wordsB.length * 100));
}

async function toggleRecording(button, track) {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    button.textContent = '●';
    button.classList.remove('recording');
    if (track) { track.classList.remove('recording'); track.innerHTML = '<span>录音完成，可以重新录制或进入下一步</span>'; }
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('浏览器暂不支持录音，已进入模拟录音模式');
    button.classList.add('recording');
    if (track) { track.classList.add('recording'); track.textContent = '正在录音… 尽量贴住原声'; }
    setTimeout(() => { button.classList.remove('recording'); if(track){track.classList.remove('recording');track.textContent='模拟录音完成';}}, 4000);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => mediaChunks.push(e.data);
    mediaRecorder.onstop = () => stream.getTracks().forEach(t => t.stop());
    mediaRecorder.start();
    button.classList.add('recording');
    button.textContent = '■';
    if (track) { track.classList.add('recording'); track.textContent = '正在录音… 尽量贴住原声'; }
  } catch {
    showToast('未获得麦克风权限，可继续体验其他功能');
  }
}

function splitTranscript(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g) || [];
  return matches.map(item => item.trim()).filter(item => item.length > 1);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function detectPauseBoundaries(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const frameSeconds = .05;
  const frameSize = Math.max(1, Math.floor(sampleRate * frameSeconds));
  const frameCount = Math.ceil(audioBuffer.length / frameSize);
  const levels = new Array(frameCount).fill(0);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const data = audioBuffer.getChannelData(channel);
    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * frameSize;
      const end = Math.min(data.length, start + frameSize);
      let sum = 0;
      for (let i = start; i < end; i += 4) sum += data[i] * data[i];
      levels[frame] += Math.sqrt(sum / Math.max(1, Math.ceil((end - start) / 4))) / audioBuffer.numberOfChannels;
    }
  }
  const noiseFloor = percentile(levels, .22);
  const speechLevel = percentile(levels, .72);
  const threshold = Math.max(.008, Math.min(.045, noiseFloor * 2.3 + speechLevel * .08));
  const pauses = [];
  let silenceStart = null;
  levels.forEach((level, index) => {
    if (level < threshold && silenceStart === null) silenceStart = index;
    if ((level >= threshold || index === levels.length - 1) && silenceStart !== null) {
      const silenceEnd = level >= threshold ? index : index + 1;
      const duration = (silenceEnd - silenceStart) * frameSeconds;
      if (duration >= .28) pauses.push((silenceStart + silenceEnd) * frameSeconds / 2);
      silenceStart = null;
    }
  });
  return pauses.filter(time => time > .45 && time < audioBuffer.duration - .45);
}

function snapTargetsToPauses(targets, pauses, duration) {
  const boundaries = [0];
  const minGap = Math.min(.65, duration / Math.max(2, targets.length + 1) * .35);
  targets.forEach((target, index) => {
    const previous = boundaries[boundaries.length - 1];
    const latest = duration - minGap * (targets.length - index);
    const candidates = pauses.filter(pause => pause > previous + minGap && pause < latest && Math.abs(pause - target) <= 2.4);
    const snapped = candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? target;
    boundaries.push(Math.min(latest, Math.max(previous + minGap, snapped)));
  });
  boundaries.push(duration);
  return boundaries;
}

function buildSegments(duration, pauses, transcriptSentences) {
  if (transcriptSentences.length) {
    const weights = transcriptSentences.map(text => Math.max(1, normalize(text).split(' ').filter(Boolean).length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let cumulative = 0;
    const targets = weights.slice(0, -1).map(weight => {
      cumulative += weight;
      return duration * cumulative / totalWeight;
    });
    const boundaries = snapTargetsToPauses(targets, pauses, duration);
    return transcriptSentences.map((text, index) => ({ text, start: boundaries[index], end: boundaries[index + 1] }));
  }

  const boundaries = [0, ...pauses, duration].sort((a, b) => a - b);
  const raw = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = raw.length && boundaries[i + 1] - boundaries[i] < 1.1 ? raw[raw.length - 1].start : boundaries[i];
    if (raw.length && start === raw[raw.length - 1].start) raw[raw.length - 1].end = boundaries[i + 1];
    else raw.push({ text: '', start, end: boundaries[i + 1] });
  }
  const result = [];
  raw.forEach(segment => {
    const length = segment.end - segment.start;
    const parts = Math.max(1, Math.ceil(length / 14));
    for (let i = 0; i < parts; i++) {
      result.push({ text: '', start: segment.start + length * i / parts, end: segment.start + length * (i + 1) / parts });
    }
  });
  return result.filter(segment => segment.end - segment.start >= .5);
}

function formatPreciseTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs}.${tenths}`;
}

function renderSentenceList() {
  const list = $('#sentenceList');
  list.innerHTML = '';
  const completedIndexes = currentCourseId ? new Set(readCourseProgress(currentCourseId).completed) : new Set();
  sentenceSegments.forEach((segment, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    const isCompleted = completedIndexes.has(index);
    item.className = `sentence-item${index === selectedSegmentIndex ? ' selected' : ''}${isCompleted ? ' completed' : ''}`;
    item.dataset.index = index;
    const displayText = segment.text || `第 ${index + 1} 句 · 原文待补充`;
    item.innerHTML = `<span class="sentence-number">${String(index + 1).padStart(2, '0')}</span><span class="sentence-copy"><strong>${escapeHtml(displayText)}</strong><small>${formatPreciseTime(segment.start)}–${formatPreciseTime(segment.end)} · ${(segment.end - segment.start).toFixed(1)} 秒</small></span><span class="sentence-play" aria-hidden="true">${isCompleted ? '✓' : '▶'}</span>`;
    item.addEventListener('click', () => {
      selectSentence(index);
      playLessonAudio(1, null, sentence);
    });
    list.appendChild(item);
  });
  $('#sentencePanel').hidden = !sentenceSegments.length;
  $('#sentenceSummary').textContent = `已生成 ${sentenceSegments.length} 句${sentenceSegments.some(item => !item.text) ? ' · 建议补充英文文本后重新拆分' : ''}`;
  $('#lessonSentenceCount').textContent = sentenceSegments.length || 1;
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function tokenizeSentence(text) {
  const parts = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?|\s+|[^\sA-Za-z]+/g) || [];
  let wordIndex = 0;
  return parts.map(value => {
    const isWord = /^[A-Za-z]+(?:['’][A-Za-z]+)?$/.test(value);
    const token = { value, isWord, lower: isWord ? value.toLowerCase().replace('’', "'") : '', wordIndex: isWord ? wordIndex : -1 };
    if (isWord) wordIndex += 1;
    return token;
  });
}

function analyzeSentence(text) {
  const tokens = tokenizeSentence(text);
  const words = tokens.filter(token => token.isWord);
  if (!words.length) return { tokens, subject: [], predicate: [], object: [], roles: new Map(), functionWords: [] };
  let verbIndex = words.findIndex((word, index) => index > 0 && (AUXILIARY_WORDS.has(word.lower) || COMMON_VERBS.has(word.lower) || /(?:ed|ing)$/.test(word.lower)));
  if (verbIndex < 0 && (AUXILIARY_WORDS.has(words[0].lower) || COMMON_VERBS.has(words[0].lower))) verbIndex = 0;
  if (verbIndex < 0) verbIndex = Math.min(1, words.length - 1);

  const invertedQuestion = verbIndex === 0 && words[1] && SUBJECT_PRONOUNS.has(words[1].lower);
  let subjectStart = 0;
  let subjectEnd = Math.max(0, verbIndex - 1);
  if (invertedQuestion) {
    subjectStart = 1;
    subjectEnd = 1;
  } else {
    const pronounIndex = words.slice(0, verbIndex).map(word => word.lower).reduce((found, word, index) => SUBJECT_PRONOUNS.has(word) ? index : found, -1);
    if (pronounIndex >= 0) subjectStart = pronounIndex;
    else {
      const firstContent = words.slice(0, verbIndex).findIndex(word => !isFunctionWord(word.lower));
      if (firstContent >= 0) subjectStart = firstContent;
    }
  }

  let predicateEnd = verbIndex;
  if (AUXILIARY_WORDS.has(words[verbIndex]?.lower)) {
    const contentOffset = words.slice(verbIndex + 1, verbIndex + 5).findIndex(word => !isFunctionWord(word.lower));
    if (contentOffset >= 0) predicateEnd = verbIndex + 1 + contentOffset;
  }
  const subjectIndices = new Set();
  for (let index = subjectStart; index <= subjectEnd; index++) subjectIndices.add(index);
  const predicateIndices = new Set();
  for (let index = verbIndex; index <= predicateEnd; index++) predicateIndices.add(index);
  if (invertedQuestion && predicateEnd < 2 && words[2]) predicateIndices.add(2);
  const objectStart = Math.max(predicateEnd + 1, invertedQuestion ? 3 : 0);
  const objectIndices = new Set(words.map((_, index) => index).filter(index => index >= objectStart && !subjectIndices.has(index)));
  const roles = new Map();
  subjectIndices.forEach(index => roles.set(index, 'subject'));
  predicateIndices.forEach(index => roles.set(index, 'predicate'));
  objectIndices.forEach(index => roles.set(index, 'object'));
  return {
    tokens,
    subject: words.filter((_, index) => subjectIndices.has(index)),
    predicate: words.filter((_, index) => predicateIndices.has(index)),
    object: words.filter((_, index) => objectIndices.has(index)),
    roles,
    functionWords: [...new Set(words.filter(word => isFunctionWord(word.lower)).map(word => word.value))]
  };
}

function usageForSentence(text) {
  const lower = text.toLowerCase();
  if (lower.includes('i worry about')) return { heading: '表达对某事的担忧', copy: 'I worry about + 名词、动名词或 what / how 从句，用来说明你担心的对象。', example: 'I worry about how this will affect children.', pattern: 'I worry about + 名词 / what 从句' };
  if (lower.includes('i worry that')) return { heading: '表达担忧并说明风险', copy: 'I worry that + 完整句子；不是只说“我担心”，而是把担心的后果说出来。', example: 'I worry that we may be moving too fast.', pattern: 'I worry that + 完整句子' };
  if (/not as .+ as/.test(lower)) return { heading: '比较实际情况与表面印象', copy: '说明某件事没有看起来那么容易、简单或明显，可以替换中间的形容词。', example: "The task isn't as easy as it looks.", pattern: 'not as + 形容词 + as' };
  if (lower.includes('what i would call')) return { heading: '给一个现象命名', copy: '先描述问题，再用 what I would call 引出你为它总结的概念或标签。', example: 'That is what I would call an adaptation gap.', pattern: 'what I would call + 名词' };
  if (lower.includes('what would it look like')) return { heading: '把抽象观点变成具体方案', copy: '从“我们应该怎么做”过渡到可观察的行动、案例或结果。', example: 'What would it look like in practice?', pattern: 'What would it look like? It would look like...' };
  if (lower.includes("we're not just") || lower.includes('not just')) return { heading: '递进强调更深层的问题', copy: '先承认一个明显问题，再用 not just... 强调真正更严重或更重要的部分。', example: "We're not just solving a technical problem.", pattern: 'not just A, but / we are B' };
  if (lower.includes('there has to be')) return { heading: '强调某件事非常有必要', copy: '比 there should be 更有力度，适合提出制度、合作或行动上的必要改变。', example: 'There has to be a better way.', pattern: 'There has to be + 名词' };
  if (lower.includes('a little less') || lower.includes('a little bit more')) return { heading: '用对称结构提出调整方向', copy: '减少一种倾向，同时增加另一种更理想的做法，常用于演讲总结。', example: 'A little less blame, a little more space.', pattern: 'a little less A, a little more B' };
  if (lower.startsWith('i want to')) return { heading: '明确接下来要谈的重点', copy: '用于演讲或讨论中的转场，让听众知道下一部分的主题。', example: 'I want to talk about a different approach.', pattern: 'I want to talk about + 主题' };
  if (lower.startsWith('and so') || lower.startsWith('so ')) return { heading: '承接前文并给出结论', copy: 'so / and so 表示“基于前面的理由，因此……”，用于推进论证。', example: 'And so we need to act now.', pattern: 'And so + 结论' };
  return { heading: '当前句的具体用途', copy: '先看这句话和前后句的关系，再把它当作一个可替换的表达，而不是孤立背诵。', example: '替换主语或关键词，造一个与你生活相关的句子。', pattern: '点击原句中的词查看可替换表达' };
}

async function loadSentenceTranslation(segment) {
  const text = String(segment.text || '').trim();
  const requestId = ++translationRequestId;
  const translationBox = $('#sentenceTranslation');
  if (!text) {
    translationBox.textContent = '暂无原句，无法生成整句翻译。';
    return;
  }
  const storedTranslation = segment.study?.translation || localStorage.getItem(`echoetch-translation-${encodeURIComponent(text)}`);
  if (storedTranslation) {
    translationBox.textContent = storedTranslation;
    return;
  }
  translationBox.textContent = '正在生成整句翻译…';
  try {
    const response = await fetch(`/api/translate?q=${encodeURIComponent(text)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
    const result = await response.json();
    if (requestId !== translationRequestId) return;
    const translation = String(result.translation || '').trim();
    if (!translation) throw new Error('Empty translation');
    translationBox.textContent = translation;
    localStorage.setItem(`echoetch-translation-${encodeURIComponent(text)}`, translation);
  } catch (error) {
    console.error(error);
    if (requestId === translationRequestId) translationBox.textContent = '暂时无法获取自动翻译，请先打开朗文释义，或根据句子主干自己确认中文理解。';
  }
}

function renderSentenceAnalysis(text) {
  const analysis = analyzeSentence(text);
  const line = $('#sentenceAnalysisLine');
  line.replaceChildren();
  analysis.tokens.forEach(token => {
    if (!token.isWord) {
      line.append(document.createTextNode(token.value));
      return;
    }
    const span = document.createElement('span');
    const role = analysis.roles.get(token.wordIndex);
    span.className = `analysis-token${role ? ` role-${role}` : ''}${role === 'subject' || role === 'predicate' ? ' main-word' : ''}${isFunctionWord(token.lower) ? ' function-word' : ''}`;
    span.dataset.word = token.value;
    span.textContent = token.value;
    line.append(span);
  });
  const subject = analysis.subject.map(word => word.value).join(' ') || '承接上文 / 省略';
  const predicate = analysis.predicate.map(word => word.value).join(' ') || '待确认';
  const object = analysis.object.map(word => word.value).join(' ') || '无明显宾语 / 补语';
  $('#sentenceSkeleton').innerHTML = `<span class="skeleton-part subject"><small>主语</small>${escapeHtml(subject)}</span><span class="skeleton-part predicate"><small>谓语</small>${escapeHtml(predicate)}</span><span class="skeleton-part object"><small>宾语 / 补语 / 其他信息</small>${escapeHtml(object)}</span>`;
  $('#structureHeading').textContent = `${subject} + ${predicate}`;
  $('#structureCopy').textContent = `自动初标：主语「${subject}」，谓语「${predicate}」；复杂句建议结合语义再次确认。`;
  $('#listeningHeading').textContent = analysis.functionWords.length ? `容易漏听：${analysis.functionWords.join(' · ')}` : '本句功能词较少';
  $('#listeningCopy').textContent = analysis.functionWords.length ? '虚线词通常会弱读、连读或缩短。先单独辨认，再放回整句原速重听。' : '重点关注重音位置和词尾，不需要刻意寻找功能词。';
  const usage = usageForSentence(text);
  $('#usageHeading').textContent = usage.heading;
  $('#usageCopy').textContent = usage.copy;
  $('#usageExample').textContent = `例句：${usage.example}`;
  $('#wordLookup').hidden = true;
  currentLookupWord = '';
  currentLookupDefinition = '';
}

function normalizeLookupText(value) {
  return value.replace(/[’]/g, "'").replace(/[^A-Za-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
}

function savedVocabularyItem(word) {
  try {
    const vocabulary = JSON.parse(localStorage.getItem('echoetch-vocabulary') || '[]');
    return vocabulary.find(item => item.word?.toLowerCase() === word.toLowerCase()) || null;
  } catch {
    return null;
  }
}

async function lookupLongman(rawValue) {
  const word = normalizeLookupText(rawValue);
  if (!word) return;
  if (word.split(' ').length > 4) {
    showToast('一次请选择一个单词或短语');
    return;
  }
  currentLookupWord = word;
  currentLookupDefinition = '';
  const savedItem = savedVocabularyItem(word);
  $('#wordLookup').hidden = false;
  $('#lookupWord').textContent = word;
  $('#lookupMeta').textContent = '正在查询 Longman Dictionary of Contemporary English…';
  $('#lookupResult').textContent = '正在读取释义…';
  $('#lookupTranslation').value = savedItem?.translation || '';
  $('#lookupExternal').href = `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word.toLowerCase())}`;
  $('#addLookupWord').disabled = false;
  $('#addLookupWord').textContent = savedItem ? '更新生词本' : '＋ 加入生词本';
  $('#lookupSaved').hidden = !savedItem;
  try {
    const response = await fetch(`/api/longman?q=${encodeURIComponent(word)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Dictionary HTTP ${response.status}`);
    const result = await response.json();
    if (currentLookupWord !== word) return;
    $('#lookupWord').textContent = result.word || word;
    $('#lookupMeta').textContent = `Longman${result.part_of_speech ? ` · ${result.part_of_speech}` : ''}`;
    $('#lookupExternal').href = result.url || $('#lookupExternal').href;
    const definitions = (result.definitions || []).map(definition => `<li>${escapeHtml(definition)}</li>`).join('');
    const example = result.examples?.[0] ? `<div class="lookup-example">例句：${escapeHtml(result.examples[0])}</div>` : '';
    currentLookupDefinition = result.definitions?.[0] || '';
    $('#lookupResult').innerHTML = definitions ? `<ul>${definitions}</ul>${example}` : 'Longman 没有返回精确词条，请点击右上角打开官网搜索。';
  } catch (error) {
    console.error(error);
    if (currentLookupWord === word) {
      $('#lookupMeta').textContent = 'Longman 暂时无法连接';
      $('#lookupResult').textContent = '可以点击右上角打开朗文官网，并把你认可的中文意思填入下方。';
    }
  }
}

function saveLookupWord() {
  if (!currentLookupWord) return;
  let vocabulary = [];
  try { vocabulary = JSON.parse(localStorage.getItem('echoetch-vocabulary') || '[]'); } catch {}
  const item = {
    word: currentLookupWord,
    definition: currentLookupDefinition,
    translation: $('#lookupTranslation').value.trim(),
    sentence,
    source: $('#sourceTitle').value.trim(),
    createdAt: new Date().toISOString()
  };
  const existingIndex = vocabulary.findIndex(entry => entry.word.toLowerCase() === item.word.toLowerCase());
  if (existingIndex >= 0) vocabulary[existingIndex] = { ...vocabulary[existingIndex], ...item };
  else vocabulary.unshift(item);
  localStorage.setItem('echoetch-vocabulary', JSON.stringify(vocabulary));
  $('#lookupSaved').hidden = false;
  $('#addLookupWord').textContent = '更新生词本';
  showToast(`已将 ${currentLookupWord} 加入生词本`);
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = value;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
  showToast(message);
}

function selectSentence(index) {
  const segment = sentenceSegments[index];
  if (!segment) return;
  selectedSegmentIndex = index;
  $('#segmentStart').value = segment.start.toFixed(1);
  $('#segmentEnd').value = segment.end.toFixed(1);
  sentence = segment.text || '';
  updateLessonContent(segment);
  $$('.sentence-item').forEach((item, itemIndex) => item.classList.toggle('selected', itemIndex === index));
  updateLessonPosition();
  if (currentCourseId) {
    const progress = readCourseProgress(currentCourseId);
    progress.lastIndex = index;
    saveCourseProgress(currentCourseId, progress);
  }
}

function updateLessonContent(segment) {
  const displaySentence = segment.text || `第 ${selectedSegmentIndex + 1} 句：原文待补充`;
  const duration = segment.end - segment.start;
  $('#lessonSentence').textContent = displaySentence;
  $('#originalSentence').textContent = displaySentence;
  $('#reviewSentenceText').textContent = displaySentence;
  $('#recallText').textContent = displaySentence;
  $('#lessonDuration').textContent = duration.toFixed(1);
  $('#targetDuration').textContent = `≤ ${Math.max(1.5, duration * 1.08).toFixed(1)} 秒`;
  $('#audioTime').textContent = formatTime(segment.start);
  $$('.audio-meta span:last-child').forEach(el => el.textContent = formatTime(duration));
  $('#dictation').value = '';
  $('#hintText').hidden = true;
  $('#hintText').textContent = segment.text ? `提示：首词是 “${segment.text.split(/\s+/)[0]}”。` : '请先粘贴英文文本并重新自动拆句，才能使用听写对比。';
  if (segment.text && selectedSegmentIndex >= 0) {
    loadSentenceTranslation(segment);
    renderSentenceAnalysis(segment.text);
  }
}

async function autoSplitAudio() {
  if (!uploadedAudioFile) {
    showToast('请先选择一个音频文件');
    return;
  }
  const button = $('#autoSplit');
  button.disabled = true;
  button.textContent = '正在分析…';
  $('#splitStatus').textContent = '正在本地分析音频停顿，不会上传文件';
  try {
    const arrayBuffer = await uploadedAudioFile.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('AudioContext unavailable');
    const context = new AudioContextClass();
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    const pauses = detectPauseBoundaries(audioBuffer);
    const transcriptSentences = splitTranscript($('#transcriptInput').value);
    sentenceSegments = buildSegments(audioBuffer.duration, pauses, transcriptSentences);
    if (!sentenceSegments.length) sentenceSegments = [{ text: transcriptSentences[0] || '', start: 0, end: audioBuffer.duration }];
    selectedSegmentIndex = 0;
    renderSentenceList();
    selectSentence(0);
    $('#splitStatus').textContent = `完成：识别到 ${pauses.length} 个自然停顿，生成 ${sentenceSegments.length} 个训练句`;
    showToast(`已自动拆分为 ${sentenceSegments.length} 句`);
    await context.close();
  } catch (error) {
    console.error(error);
    const isMp4 = uploadedAudioFile.name.toLowerCase().endsWith('.mp4');
    $('#splitStatus').textContent = isMp4 ? '拆分失败：无法解码 MP4 音轨，请确认文件包含 AAC 音频' : '拆分失败：浏览器无法解码此音频，请尝试 MP3 或 WAV';
    showToast(isMp4 ? '无法分析 MP4 音轨，请尝试转换为 MP3' : '音频分析失败，请尝试 MP3 或 WAV');
  } finally {
    button.disabled = false;
    button.textContent = '重新自动拆分';
  }
}

const sourceProfiles = {
  bbc: { brand: 'BBC LEARNING ENGLISH', title: 'BBC Learning English · 6 Minute English', placeholder: 'https://www.bbc.co.uk/learningenglish/...' },
  ted: { brand: 'TED / TED-ED', title: 'TED Talk', placeholder: 'https://www.ted.com/talks/...' },
  other: { brand: 'YOUR AUDIO', title: '自定义真实语料', placeholder: 'https://...' }
};

function updateSourceProfile(type, replaceTitle = false) {
  const profile = sourceProfiles[type] || sourceProfiles.other;
  $('#sourceBrand').textContent = profile.brand;
  $('#sourceUrl').placeholder = profile.placeholder;
  if (replaceTitle) $('#sourceTitle').value = profile.title;
}

$('#sourceType').addEventListener('change', event => {
  updateSourceProfile(event.target.value, true);
  showToast(event.target.value === 'ted' ? '已切换为 TED 语料模式' : '已更新语料来源');
});

$('#autoSplit').addEventListener('click', autoSplitAudio);

function setSourceUrlStatus(message, state = '') {
  const status = $('#sourceUrlStatus');
  status.textContent = message;
  status.className = state;
}

function isDirectAudioUrl(url) {
  return /\.(mp3|m4a|mp4|wav|ogg|webm|aac|flac)(?:$|[?#])/i.test(url);
}

function inferTitleFromUrl(url) {
  const slug = url.pathname.split('/').filter(Boolean).pop() || '';
  return decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()).slice(0, 90);
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(.1, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function validateMediaFile(file) {
  const supported = file.type.startsWith('audio/') || file.type === 'video/mp4' || /\.(mp3|m4a|mp4|wav|ogg|webm|aac|flac)$/i.test(file.name);
  if (!supported) return '请选择 MP3、M4A、MP4、WAV、OGG 或 WebM 文件';
  if (file.size > MAX_MEDIA_BYTES) return '文件不能超过 800MB，请先裁剪或压缩';
  return '';
}

function isMp4File(file) {
  return file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
}

function hideMediaOptimizer() {
  $('#mediaOptimize').hidden = true;
  $('#optimizeProgress').hidden = true;
  $('#cancelOptimize').hidden = true;
  $('#useOriginalMedia').hidden = false;
  $('#optimizeMedia').hidden = false;
  $('#optimizeMedia').disabled = false;
  $('#useOriginalMedia').disabled = false;
  $('#optimizeProgressBar').style.width = '0%';
}

function showMediaOptimizer(file) {
  pendingMediaFile = file;
  const mp4 = isMp4File(file);
  $('#audioFileName').textContent = file.name;
  $('#audioDuration').textContent = `文件大小 ${formatFileSize(file.size)} · 等待选择处理方式`;
  $('.source-dot').classList.add('ready');
  $('#mediaOptimize').hidden = false;
  $('#optimizeTitle').textContent = `${file.name} · ${formatFileSize(file.size)}`;
  $('#optimizeSummary').textContent = mp4
    ? '建议移除视频画面并提取单声道 AAC 音轨，原文件不会被修改'
    : `${file.size > LARGE_MEDIA_BYTES ? '大文件可能占用较多内存。' : ''}可压缩为单声道 AAC 音轨后再拆句`;
  $('#optimizeMedia').textContent = mp4 ? '提取轻量音轨' : '压缩音频';
  $('#optimizeProgress').hidden = true;
  $('#cancelOptimize').hidden = true;
  $('#useOriginalMedia').hidden = false;
  $('#optimizeMedia').hidden = false;
  $('#optimizeMedia').disabled = false;
  $('#useOriginalMedia').disabled = false;
  $('#optimizeProgressBar').style.width = '0%';
}

async function prepareMediaFile(file) {
  if (isOptimizingMedia) {
    showToast('正在处理上一个文件，请稍候或取消');
    return false;
  }
  const validationError = validateMediaFile(file);
  if (validationError) {
    showToast(validationError);
    return false;
  }
  if (isMp4File(file) || file.size > OPTIMIZE_MEDIA_BYTES) {
    showMediaOptimizer(file);
    return 'queued';
  }
  hideMediaOptimizer();
  return (await loadAudioFile(file)) ? 'loaded' : false;
}

function loadExternalScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  loadExternalScript.cache ||= new Map();
  if (loadExternalScript.cache.has(src)) return loadExternalScript.cache.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => window[globalName] ? resolve() : reject(new Error(`${globalName} unavailable`));
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
  loadExternalScript.cache.set(src, promise);
  promise.catch(() => loadExternalScript.cache.delete(src));
  return promise;
}

function updateOptimizeProgress(percent, message) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $('#optimizeProgressBar').style.width = `${value}%`;
  $('#optimizeProgressText').textContent = `${message} · ${value}%`;
}

async function getFFmpeg() {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  await Promise.all([
    loadExternalScript(`${FFMPEG_PACKAGE_URL}/ffmpeg.js`, 'FFmpegWASM'),
    loadExternalScript(`${FFMPEG_UTIL_URL}/index.js`, 'FFmpegUtil')
  ]);
  const ffmpeg = new window.FFmpegWASM.FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    if (isOptimizingMedia && Number.isFinite(progress)) updateOptimizeProgress(15 + progress * 82, '正在提取并压缩音轨');
  });
  const { toBlobURL } = window.FFmpegUtil;
  const [classWorkerURL, coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${FFMPEG_PACKAGE_URL}/814.ffmpeg.js`, 'text/javascript'),
    toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, 'application/wasm')
  ]);
  await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

async function optimizePendingMedia() {
  const file = pendingMediaFile;
  if (!file || isOptimizingMedia) return;
  isOptimizingMedia = true;
  optimizationCancelled = false;
  $('#optimizeProgress').hidden = false;
  $('#cancelOptimize').hidden = false;
  $('#useOriginalMedia').hidden = true;
  $('#optimizeMedia').hidden = true;
  updateOptimizeProgress(2, '正在加载本地处理引擎');
  let inputName = '';
  const outputName = 'echoetch-optimized.m4a';
  try {
    const ffmpeg = await getFFmpeg();
    if (optimizationCancelled) return;
    updateOptimizeProgress(10, '正在读取原文件');
    const extension = (file.name.split('.').pop() || 'media').replace(/[^a-z0-9]/gi, '').toLowerCase();
    inputName = `echoetch-input.${extension || 'media'}`;
    const sourceData = await window.FFmpegUtil.fetchFile(file);
    await ffmpeg.writeFile(inputName, sourceData);
    if (optimizationCancelled) return;
    await ffmpeg.exec(['-i', inputName, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outputName]);
    if (optimizationCancelled) return;
    const data = await ffmpeg.readFile(outputName);
    const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'echoetch-audio';
    const optimizedFile = new File([data], `${baseName}-audio.m4a`, { type: 'audio/mp4', lastModified: Date.now() });
    updateOptimizeProgress(100, `完成 ${formatFileSize(file.size)} → ${formatFileSize(optimizedFile.size)}`);
    $('#optimizeTitle').textContent = '轻量音轨已生成';
    $('#optimizeSummary').textContent = `已使用 ${optimizedFile.name}，原文件保持不变`;
    $('#cancelOptimize').hidden = true;
    pendingMediaFile = null;
    await loadAudioFile(optimizedFile);
  } catch (error) {
    console.error(error);
    if (!optimizationCancelled) {
      updateOptimizeProgress(0, '处理失败');
      $('#optimizeSummary').textContent = '无法完成本地压缩，可直接使用原文件或检查网络后重试';
      $('#useOriginalMedia').hidden = false;
      $('#optimizeMedia').hidden = false;
      $('#optimizeMedia').textContent = '重试';
      showToast('本地压缩失败，可直接使用原文件');
    }
  } finally {
    if (ffmpegInstance?.loaded) {
      if (inputName) await ffmpegInstance.deleteFile(inputName).catch(() => {});
      await ffmpegInstance.deleteFile(outputName).catch(() => {});
    }
    isOptimizingMedia = false;
  }
}

function cancelMediaOptimization() {
  if (!isOptimizingMedia) return;
  optimizationCancelled = true;
  ffmpegInstance?.terminate();
  ffmpegInstance = null;
  isOptimizingMedia = false;
  $('#cancelOptimize').hidden = true;
  $('#useOriginalMedia').hidden = false;
  $('#optimizeMedia').hidden = false;
  $('#optimizeMedia').textContent = isMp4File(pendingMediaFile) ? '提取轻量音轨' : '压缩音频';
  updateOptimizeProgress(0, '已取消');
  showToast('已取消本地处理');
}

function inspectSourceUrl() {
  const value = $('#sourceUrl').value.trim();
  const action = $('#sourceLinkAction');
  sourceLinkMode = 'none';
  sourceLinkUrl = '';
  action.disabled = true;
  action.textContent = '识别链接';
  if (!value) {
    setSourceUrlStatus('粘贴 BBC 或 TED 页面链接，或可直接访问的音频直链');
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    setSourceUrlStatus('链接格式不正确，请粘贴以 http:// 或 https:// 开头的完整链接', 'error');
    return;
  }

  sourceLinkUrl = parsed.href;
  action.disabled = false;
  const host = parsed.hostname.toLowerCase();
  if (isDirectAudioUrl(parsed.href)) {
    sourceLinkMode = 'audio';
    action.textContent = '导入音频';
    setSourceUrlStatus('检测到音频直链。点击“导入音频”后会尝试读取；来源服务器必须允许跨域访问。', 'valid');
    return;
  }

  sourceLinkMode = 'page';
  action.textContent = '打开来源 ↗';
  if (host === 'ted.com' || host.endsWith('.ted.com')) {
    $('#sourceType').value = 'ted';
    updateSourceProfile('ted', false);
    const inferredTitle = inferTitleFromUrl(parsed);
    if (inferredTitle && /^(TED Talk|BBC Learning English)/i.test($('#sourceTitle').value.trim())) $('#sourceTitle').value = inferredTitle;
    setSourceUrlStatus('已识别 TED 官方页面。网页链接不能直接提取音频，请打开来源后合法获取音频或字幕。', 'warning');
  } else if (host === 'bbc.co.uk' || host.endsWith('.bbc.co.uk') || host === 'bbc.com' || host.endsWith('.bbc.com')) {
    $('#sourceType').value = 'bbc';
    updateSourceProfile('bbc', false);
    setSourceUrlStatus('已识别 BBC 官方页面。该链接会作为出处保存；网页中的音频不能由静态页面直接抓取。', 'warning');
  } else {
    $('#sourceType').value = 'other';
    updateSourceProfile('other', false);
    setSourceUrlStatus('已识别网页链接，将作为语料出处保存。网页内容不会被自动下载。', 'valid');
  }
}

async function loadAudioFile(file, options = {}) {
  const validationError = validateMediaFile(file);
  if (validationError) {
    showToast(validationError);
    return false;
  }
  uploadedAudioFile = file;
  sentenceSegments = [];
  selectedSegmentIndex = -1;
  $('#sentencePanel').hidden = true;
  $('#autoSplit').disabled = true;
  if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl);
  uploadedAudioUrl = URL.createObjectURL(file);
  const audio = $('#sourceAudio');
  audio.src = uploadedAudioUrl;
  $('#audioFileName').textContent = file.name;
  $('#audioDuration').textContent = '正在读取音频信息…';
  $('.source-dot').classList.add('ready');
  audio.onloadedmetadata = () => {
    const mins = Math.floor(audio.duration / 60);
    const secs = Math.floor(audio.duration % 60).toString().padStart(2, '0');
    $('#audioDuration').textContent = `时长 ${mins}:${secs} · 文件仅在本地使用`;
    $('#segmentStart').max = Math.max(0, audio.duration - .5);
    $('#segmentEnd').max = audio.duration;
    $('#segmentEnd').value = Math.min(8, audio.duration).toFixed(1);
    $('#autoSplit').disabled = false;
    if (Array.isArray(options.segments) && options.segments.length) {
      sentenceSegments = options.segments.map(segment => ({
        ...segment,
        start: Number(segment.start),
        end: Number(segment.end),
        text: String(segment.text || '').trim()
      })).filter(segment => segment.text && segment.end > segment.start);
      const requestedIndex = Math.max(0, Math.min(sentenceSegments.length - 1, Number(options.startIndex) || 0));
      selectedSegmentIndex = sentenceSegments.length ? requestedIndex : -1;
      renderSentenceList();
      if (sentenceSegments.length) selectSentence(requestedIndex);
      $('#splitStatus').textContent = `已载入预处理时间轴，共 ${sentenceSegments.length} 个训练句`;
      showToast(`TED 课程已拆解为 ${sentenceSegments.length} 句`);
    } else {
      $('#splitStatus').textContent = '音频已就绪，正在自动分析停顿';
      showToast('音频已载入，开始自动拆句');
      autoSplitAudio();
    }
  };
  audio.onerror = () => {
    $('#autoSplit').disabled = true;
    $('#audioDuration').textContent = '无法读取此音频编码';
    showToast(file.name.toLowerCase().endsWith('.mp4') ? '无法读取 MP4 音轨，请确认文件包含 AAC 音频' : '音频分析失败，请尝试 MP3 或 WAV');
  };
  return true;
}

async function loadPreparedLessonFromQuery() {
  const lessonPath = new URLSearchParams(window.location.search).get('lesson');
  if (!lessonPath) {
    updateCatalogProgress();
    return;
  }
  document.body.classList.remove('library-mode');
  document.body.classList.add('lesson-mode');
  currentCourseId = Object.entries(COURSE_CATALOG).find(([, course]) => course.lessonPath === lessonPath.replace(/^\.\//, ''))?.[0] || 'prepared-course';
  try {
    const manifestUrl = new URL(lessonPath, window.location.href);
    if (manifestUrl.origin !== window.location.origin) throw new Error('Prepared lesson must be local');
    const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error(`Lesson HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    if (!Array.isArray(manifest.segments) || !manifest.segments.length) throw new Error('Lesson has no segments');
    const audioUrl = new URL(manifest.source?.learning_audio || 'learning-audio.m4a', manifestUrl);
    if (audioUrl.origin !== window.location.origin) throw new Error('Prepared audio must be local');
    const audioResponse = await fetch(audioUrl, { cache: 'no-store' });
    if (!audioResponse.ok) throw new Error(`Audio HTTP ${audioResponse.status}`);
    const audioBlob = await audioResponse.blob();
    const audioName = decodeURIComponent(audioUrl.pathname.split('/').pop()) || 'learning-audio.m4a';
    const audioFile = new File([audioBlob], audioName, { type: audioBlob.type || 'audio/mp4' });
    const title = manifest.source?.title || 'Prepared TED lesson';
    const speaker = manifest.source?.speaker || 'TED';
    const officialUrl = manifest.source?.official_url || '';
    currentCourseTotal = manifest.segments.length;
    $('#sourceType').value = manifest.source?.type || 'ted';
    updateSourceProfile($('#sourceType').value, false);
    $('#sourceTitle').value = title;
    $('#sourceUrl').value = officialUrl;
    $('#transcriptInput').value = manifest.segments.map(segment => segment.text).join(' ');
    hideMediaOptimizer();
    $('#lessonMetaLine').textContent = `${title} · ${speaker}`;
    $('#lessonContext').textContent = `${speaker} · 固定课程 · 逐句训练`;
    document.title = `${title} · 声刻 EchoEtch`;
    const progress = readCourseProgress(currentCourseId);
    await loadAudioFile(audioFile, { segments: manifest.segments, startIndex: progress.lastIndex });
  } catch (error) {
    console.error(error);
    showToast('预处理 TED 课程载入失败');
    $('#splitStatus').textContent = '课程包载入失败，请检查本地文件是否完整';
  }
}

async function importAudioFromUrl(url) {
  const action = $('#sourceLinkAction');
  action.disabled = true;
  action.textContent = '正在导入…';
  setSourceUrlStatus('正在读取音频直链…', 'valid');
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length')) || 0;
    if (length > MAX_MEDIA_BYTES) throw new Error('文件超过 800MB');
    const blob = await response.blob();
    if (blob.size > MAX_MEDIA_BYTES) throw new Error('文件超过 800MB');
    const pathname = new URL(url).pathname;
    const fileName = decodeURIComponent(pathname.split('/').pop()) || 'remote-audio.mp3';
    const file = new File([blob], fileName, { type: blob.type || 'audio/mpeg' });
    const result = await prepareMediaFile(file);
    if (result === 'loaded') setSourceUrlStatus('音频直链导入成功，正在自动拆句。', 'valid');
    if (result === 'queued') setSourceUrlStatus('文件已读取，请选择提取轻量音轨或直接使用原文件。', 'valid');
  } catch (error) {
    console.error(error);
    const tooLarge = /800MB/.test(error.message);
    setSourceUrlStatus(tooLarge ? '远程文件超过 800MB，请先裁剪或压缩。' : '无法从该链接读取音频。通常是来源网站禁止跨域下载，请改用“选择音频”。', 'error');
    showToast(tooLarge ? '文件超过 800MB' : '链接导入失败，请下载后选择本地音频');
  } finally {
    action.disabled = false;
    action.textContent = sourceLinkMode === 'audio' ? '导入音频' : '打开来源 ↗';
  }
}

$('#sourceUrl').addEventListener('input', () => {
  clearTimeout(inspectSourceUrl.timeout);
  inspectSourceUrl.timeout = setTimeout(inspectSourceUrl, 180);
});
$('#sourceUrl').addEventListener('paste', () => setTimeout(inspectSourceUrl, 0));
$('#sourceUrl').addEventListener('change', inspectSourceUrl);
$('#sourceUrl').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  inspectSourceUrl();
  if (!$('#sourceLinkAction').disabled) $('#sourceLinkAction').click();
});
$('#sourceLinkAction').addEventListener('click', () => {
  if (sourceLinkMode === 'audio') importAudioFromUrl(sourceLinkUrl);
  else if (sourceLinkMode === 'page') window.open(sourceLinkUrl, '_blank', 'noopener,noreferrer');
});

$('#audioUpload').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const result = await prepareMediaFile(file);
  if (!result) event.target.value = '';
});

const sourceDropZone = $('#sourceDropZone');
let sourceDragDepth = 0;

function isFileDrag(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}

sourceDropZone.addEventListener('dragenter', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  sourceDragDepth += 1;
  sourceDropZone.classList.add('is-dragging');
});

sourceDropZone.addEventListener('dragover', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

sourceDropZone.addEventListener('dragleave', event => {
  if (!sourceDragDepth) return;
  sourceDragDepth = Math.max(0, sourceDragDepth - 1);
  if (!sourceDragDepth) sourceDropZone.classList.remove('is-dragging');
});

sourceDropZone.addEventListener('drop', async event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  sourceDragDepth = 0;
  sourceDropZone.classList.remove('is-dragging');
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  if (files.length > 1) showToast('一次只能导入一个文件，已选择第一个');
  await prepareMediaFile(files[0]);
});

document.addEventListener('dragover', event => {
  if (isFileDrag(event)) event.preventDefault();
});

document.addEventListener('drop', event => {
  if (isFileDrag(event) && !sourceDropZone.contains(event.target)) event.preventDefault();
});

$('#optimizeMedia').addEventListener('click', optimizePendingMedia);
$('#cancelOptimize').addEventListener('click', cancelMediaOptimization);
$('#useOriginalMedia').addEventListener('click', async () => {
  if (!pendingMediaFile || isOptimizingMedia) return;
  const file = pendingMediaFile;
  pendingMediaFile = null;
  hideMediaOptimizer();
  if (file.size > LARGE_MEDIA_BYTES) showToast('正在直接读取大文件，处理期间请勿关闭页面');
  await loadAudioFile(file);
});

$('#applySource').addEventListener('click', () => {
  const audio = $('#sourceAudio');
  if (!audio.src) {
    showToast('请先选择一个音频文件');
    return;
  }
  const { start, end } = getSegment();
  if (end <= start) {
    showToast('结束时间必须晚于开始时间');
    return;
  }
  if (selectedSegmentIndex < 0) {
    const transcriptSentences = splitTranscript($('#transcriptInput').value);
    const text = transcriptSentences[0] || '';
    sentenceSegments = [{ text, start, end }];
    selectedSegmentIndex = 0;
    renderSentenceList();
    selectSentence(0);
  } else {
    sentenceSegments[selectedSegmentIndex] = { ...sentenceSegments[selectedSegmentIndex], start, end };
    selectSentence(selectedSegmentIndex);
    renderSentenceList();
  }
  const sourceType = $('#sourceType').value;
  const profile = sourceProfiles[sourceType] || sourceProfiles.other;
  const title = $('#sourceTitle').value.trim() || profile.title;
  const sourceUrl = $('#sourceUrl').value.trim();
  $('#sourceBrand').textContent = profile.brand;
  $('.lesson-meta span:first-child').textContent = `${title} · 本地语料`;
  $('#audioTime').textContent = formatTime(start);
  $$('.audio-meta span:last-child').forEach(el => el.textContent = formatTime(end - start));
  localStorage.setItem('echoetch-source-meta', JSON.stringify({ sourceType, title, sourceUrl, start, end, transcript: $('#transcriptInput').value }));
  showToast(`已应用 ${start.toFixed(1)}–${end.toFixed(1)} 秒片段`);
  $('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

const savedSourceMeta = localStorage.getItem('echoetch-source-meta');
if (savedSourceMeta) {
  try {
    const meta = JSON.parse(savedSourceMeta);
    $('#sourceType').value = meta.sourceType || 'bbc';
    updateSourceProfile($('#sourceType').value, false);
    $('#sourceTitle').value = meta.title || sourceProfiles[$('#sourceType').value].title;
    $('#sourceUrl').value = meta.sourceUrl || '';
    if (meta.sourceUrl) inspectSourceUrl();
    $('#segmentStart').value = meta.start ?? 0;
    $('#segmentEnd').value = meta.end ?? 8;
    $('#transcriptInput').value = meta.transcript || '';
  } catch {}
}

buildWaves();
renderSentenceAnalysis(sentence);
$$('.step-tab').forEach(tab => tab.addEventListener('click', () => goToStep(tab.dataset.step)));
$$('.next-step').forEach(button => button.addEventListener('click', () => goToStep(button.dataset.next, true)));

$('#playBlind').addEventListener('click', function () {
  listenCount++;
  $('#listenCount').textContent = `${Math.min(listenCount, 3)} / 3`;
  $$('#listenDots i').forEach((dot, i) => dot.classList.toggle('on', i < listenCount));
  playLessonAudio(blindRate, this);
});
$('#blindSpeed').addEventListener('click', function () {
  const rates = [.75, 1, 1.15];
  blindRate = rates[(rates.indexOf(blindRate) + 1) % rates.length];
  this.textContent = `${blindRate}×`;
});
$('#hintButton').addEventListener('click', () => { $('#hintText').hidden = false; });
$('#checkButton').addEventListener('click', () => {
  const answer = $('#dictation').value.trim();
  if (!answer) { showToast('先写下你听到的内容'); return; }
  if (!sentence) { showToast('这句话还没有原文，请粘贴文本后重新拆句'); return; }
  const score = similarity(answer, sentence);
  $('#dictationScore').textContent = `${score}%`;
  $('#yourAnswer').textContent = answer;
  $('#scoreTitle').textContent = score >= 90 ? '听得很准，细节也抓住了' : score >= 65 ? '主干听懂了，再看两个细节' : '先定位差异，再带着答案重听';
  $('#scoreCopy').textContent = score >= 90 ? '继续关注连读和语调，让表达更自然。' : '重点比较缩写、比较结构和句尾的弱读。';
  goToStep(2, true);
});

$$('[data-speak]').forEach(button => button.addEventListener('click', () => {
  const rate = currentStep === 3 ? Number($('#reviewSpeed').value) : 1;
  playLessonAudio(rate, button.classList.contains('play-main') ? button : null, sentence || button.dataset.speak);
}));
function lookupCurrentSelection(root) {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const commonNode = selection.getRangeAt(0).commonAncestorContainer;
    const commonElement = commonNode.nodeType === Node.TEXT_NODE ? commonNode.parentElement : commonNode;
    if (commonElement && root.contains(commonElement)) lookupLongman(selection.toString());
  }, 0);
}
[$('#originalSentence'), $('#sentenceAnalysisLine')].forEach(root => {
  root.addEventListener('mouseup', () => lookupCurrentSelection(root));
  root.addEventListener('touchend', () => lookupCurrentSelection(root));
});
$('#sentenceAnalysisLine').addEventListener('click', event => {
  if (!window.getSelection()?.isCollapsed) return;
  const token = event.target.closest('[data-word]');
  if (token) lookupLongman(token.dataset.word);
});
$('#addLookupWord').addEventListener('click', saveLookupWord);
$('#copyStructure').addEventListener('click', () => copyText(`${$('#structureHeading').textContent}\n${$('#structureCopy').textContent}`, '主干笔记已复制'));
$('#slowListenSentence').addEventListener('click', function () {
  playLessonAudio(.75, this);
  this.textContent = '正在以 0.75× 重听';
  setTimeout(() => { this.textContent = '0.75× 重听当前句'; }, 1800);
});
$('#copyUsage').addEventListener('click', () => {
  const usage = usageForSentence(sentence);
  copyText(`${usage.pattern}\n${usage.example}`, '可复用表达已复制');
});
$$('.save-chip').forEach(button => button.addEventListener('click', () => {
  button.classList.toggle('saved');
  button.textContent = button.classList.contains('saved') ? '✓ 已收藏' : '＋ 收藏到笔记';
  showToast(button.classList.contains('saved') ? '已加入今日复习清单' : '已取消收藏');
}));
$('#hideSentence').addEventListener('click', function () {
  const box = $('.review-sentence');
  box.classList.toggle('hidden-text');
  this.textContent = box.classList.contains('hidden-text') ? '显示原句' : '隐藏文本挑战';
});

$$('.focus-chip').forEach(button => button.addEventListener('click', () => {
  $$('.focus-chip').forEach(b => b.classList.remove('selected'));
  button.classList.add('selected');
}));
$('#shadowSpeed').addEventListener('input', e => $('#shadowSpeedLabel').textContent = `${e.target.value}×`);
$('#shadowPlay').addEventListener('click', () => playLessonAudio(Number($('#shadowSpeed').value), $('#shadowPlay')));
$('#recordButton').addEventListener('click', () => toggleRecording($('#recordButton'), $('#recordTrack')));
$('#retryRecord').addEventListener('click', () => { $('#recordTrack').textContent = '点击录音，跟着原声一起说'; showToast('已清空本轮录音'); });

const peek = $('#peekButton');
const reveal = () => $('#recallText').classList.remove('blurred');
const conceal = () => $('#recallText').classList.add('blurred');
['mousedown','touchstart'].forEach(event => peek.addEventListener(event, e => { e.preventDefault(); reveal(); }));
['mouseup','mouseleave','touchend'].forEach(event => peek.addEventListener(event, conceal));

$('#reciteButton').addEventListener('click', async function () {
  if (this.classList.contains('recording')) {
    this.classList.remove('recording');
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    clearInterval(timerInterval);
    const elapsed = (Date.now() - recordStart) / 1000;
    const targetSeconds = Math.max(1.5, getSegment().duration * 1.08);
    if (elapsed <= targetSeconds && elapsed >= .8) successCount = Math.min(3, successCount + 1);
    $('#successCount').textContent = `${successCount} / 3 次`;
    this.querySelector('strong').textContent = successCount >= 3 ? '挑战完成！' : '再来一次';
    this.querySelector('small').textContent = `本次 ${elapsed.toFixed(1)} 秒 · ${elapsed <= targetSeconds ? '达到原速' : '再快一点'}`;
    if (successCount >= 3) showToast('连续三次完成，可以结束今日训练了');
    return;
  }
  recordStart = Date.now();
  this.classList.add('recording');
  this.querySelector('strong').textContent = '正在背诵…';
  this.querySelector('small').textContent = '完成后再次点击';
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - recordStart) / 1000;
    $('#reciteTimer').textContent = `00:${String(Math.floor(elapsed)).padStart(2,'0')}.${Math.floor((elapsed % 1) * 10)}`;
  }, 100);
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      mediaRecorder.start();
    } catch {}
  }
});

function resetSentenceSession() {
  stopSourceAudio();
  listenCount = 0;
  successCount = 0;
  $('#listenCount').textContent = '0 / 3';
  $$('#listenDots i').forEach(dot => dot.classList.remove('on'));
  $$('.step-tab').forEach(tab => tab.classList.remove('completed'));
  $('#dictationScore').textContent = '—';
  $('#yourAnswer').textContent = '尚未提交';
  $('#scoreTitle').textContent = '提交听写后查看结果';
  $('#scoreCopy').textContent = '系统会标出遗漏和听错的部分。';
  $('#successCount').textContent = '0 / 3 次';
  $('#reciteTimer').textContent = '00:00.0';
  $('#recallText').classList.add('blurred');
  $('.review-sentence').classList.remove('hidden-text');
  $('#hideSentence').textContent = '隐藏文本挑战';
  $('#wordLookup').hidden = true;
  goToStep(1, false, false);
}

$('#finishLesson').addEventListener('click', () => {
  $$('.step-tab').forEach(tab => tab.classList.add('completed'));
  let completedCount = 1;
  let completionPercent = 100;
  if (currentCourseId && selectedSegmentIndex >= 0) {
    const progress = readCourseProgress(currentCourseId);
    progress.completed = [...new Set([...progress.completed, selectedSegmentIndex])].sort((a, b) => a - b);
    progress.lastIndex = selectedSegmentIndex;
    saveCourseProgress(currentCourseId, progress);
    completedCount = progress.completed.length;
    completionPercent = Math.round(completedCount / (currentCourseTotal || sentenceSegments.length || 1) * 100);
    renderSentenceList();
    updateCatalogProgress();
  }
  $('#completedSentenceCount').textContent = completedCount;
  $('#courseCompletionPercent').textContent = `${completionPercent}%`;
  $('#closeCompletion').textContent = selectedSegmentIndex < sentenceSegments.length - 1 ? '继续下一句' : '返回课程列表';
  $('#completion').hidden = false;
  localStorage.setItem('echo-session-complete', new Date().toISOString());
});
$('#closeCompletion').addEventListener('click', () => {
  $('#completion').hidden = true;
  if (selectedSegmentIndex >= sentenceSegments.length - 1) {
    window.location.href = './';
    return;
  }
  resetSentenceSession();
  selectSentence(selectedSegmentIndex + 1);
  renderSentenceList();
  $('.sentence-item.selected')?.scrollIntoView({ block: 'nearest' });
  $('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#completion').addEventListener('click', e => { if (e.target === $('#completion')) $('#completion').hidden = true; });

window.speechSynthesis?.getVoices?.();
loadPreparedLessonFromQuery();
