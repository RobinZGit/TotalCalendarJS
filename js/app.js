/* =============================================================================
 * БЛОК 2 — app.js
 * Логика UI, тренировки, календарь, экспорт, движок ритма.
 * ============================================================================= */

 //надписи на кнопке при изменении статуса тренировки (эти же константы используются как ИД статусов - не делать тексты одинаковыми!)
 const TXT_BTN_NOTSTARTED = "Начать";
 const TXT_BTN_STARTED = "Идет тренировка...";
 const TXT_BTN_PAUSED = "Тренировка приостановлена...";
 const TXT_BTN_FINISHED = "Тренировка завершена";
 var Gl_State = TXT_BTN_NOTSTARTED;
 var Gl_IsFinished =false
 var Gl_BackSpace = "__BCKSPC__"

 /** Тренировка идёт или на паузе — скрываем ссылки на схему/печать. */
 function isActiveTrainingSession() {
   return !Gl_IsFinished && (GlIsRunning || Gl_State === TXT_BTN_STARTED || Gl_State === TXT_BTN_PAUSED);
 }

 function syncTrainPageSetupLinksVisibility() {
   var active = isActiveTrainingSession();
   var head = document.getElementById("idTrainingHeadSticky");
   var awake = document.getElementById("idTrainingScreenAwake");
   var liveName = document.getElementById("idTrainingLiveName");
   if (head) head.classList.toggle("training-head-sticky--active", active);
   if (awake) awake.hidden = !active || !!window.AndroidTraining;
   if (liveName) {
     if (active) {
       var n = String(Gl_currentTrainName || "").replace(/\s+/g, " ").trim();
       liveName.textContent = n;
       liveName.hidden = !n;
     } else {
       liveName.textContent = "";
       liveName.hidden = true;
     }
   }
   var links = document.getElementById("idTrainPageSetupLinks");
   var ext = document.getElementById("externalcall");
   var appLink = document.getElementById("openAndroidAppLink");
   if (links) links.style.display = active ? "none" : "";
   if (ext) ext.style.display = active ? "none" : "block";
   if (appLink) appLink.style.display = active ? "none" : "";
   syncPrevNextNavButtons();
   try { syncHeartRateChartVisibility(); } catch (e) {}
 }

 var TCJS_TRAINING_SESSION_KEY = "tcjs_active_training_v1";
 var TCJS_LAST_TRAINING_KEY = "tcjs_last_training_v1";
 var TCJS_LAST_TRAININGS_KEY = "tcjs_last_trainings_v1";
 var TCJS_LAST_TRAINING_MAX = 10;
 /** Локальная копия экспорта .genall (календари + Gl_aMetaRithm). */
 var TCJS_LOCAL_TRAININGS_KEY = "tcjs_trainings_genall_v1";
 /** Последний e-mail для отправки экспортированных файлов. */
 var TCJS_EXPORT_EMAIL_KEY = "tcjs_export_email_v1";
 var Gl_savedTrainingsBrowseIndex = 0;
 var Gl_resumeFromHistoryOnRun = false;
 var Gl_historyPreviewSnap = null;
 var Gl_trainingSessionSaveTimer = null;
 var Gl_lastTrainingAutoSaveTimer = null;
 var Gl_lastTrainingPeriodicTimer = null;
 var Gl_hadHeartRateDuringTraining = false;
 var Gl_batteryLowSaveDone = false;
 /** Блокирует аварийные сохранения при штатном «Завершить» (Android onPause иначе снова открывает диалог). */
 var Gl_suppressEmergencySave = false;
 var Gl_trainEditorBaseline = "";
 var Gl_trainEditorIndex = -1;
 var Gl_trainEditorSourceIndex = -1;
 var Gl_trainEditorOriginalName = "";

 function sanitizeTrainFilename(name){
   var s = String(name || "training").replace(/\s+/g, " ").trim();
   s = s.replaceAll("\n", "").replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, "");
   if (!s) s = "training";
   return s;
 }

 function buildRtmTextFromArithmLisp(aRithmLisp, trainName){
   var lines = (aRithmLisp || []).slice().map(function(v){ return String(v).replaceAll("\n", ""); });
   if (!lines.length) return "";
   var title = sanitizeTrainFilename(trainName);
   var header = "1000\n " + title + ". Тренировка продлится " + calcTtrainTime(lines) + " минут\n ";
   return header + lines.join("\n");
 }

 function readTrainingUiSettings(){
   var ns = document.getElementById("idNoSound");
   var rateEl = document.getElementById("inputRate");
   var stopChk = document.getElementById("idStopSpeakIfNext");
   var stopSpeak = stopChk ? !!stopChk.checked : !!Gl_StopSpeakIfNext;
   Gl_StopSpeakIfNext = stopSpeak;
   return {
     noSound: !!(ns && ns.checked),
     speechRate: rateEl ? String(rateEl.value || "1.5") : "1.5",
     stopSpeakIfNext: stopSpeak
   };
 }

 function applyTrainingUiSettingsFromSnap(snap){
   if (!snap) return;
   var ui = readTrainingUiSettings();
   var noSound = snap.noSound != null ? !!snap.noSound : ui.noSound;
   var speechRate = snap.speechRate != null && String(snap.speechRate) !== "" ? String(snap.speechRate) : ui.speechRate;
   var stopSpeakIfNext = snap.stopSpeakIfNext != null ? !!snap.stopSpeakIfNext : ui.stopSpeakIfNext;
   try {
     var ns = document.getElementById("idNoSound");
     if (ns) ns.checked = noSound;
     syncAndroidNoSoundMode();
   } catch (e) {}
   try {
     var rateEl = document.getElementById("inputRate");
     if (rateEl) rateEl.value = speechRate;
   } catch (e) {}
   try {
     var stopChk = document.getElementById("idStopSpeakIfNext");
     if (stopChk) {
       stopChk.checked = stopSpeakIfNext;
       Gl_StopSpeakIfNext = stopSpeakIfNext;
     }
   } catch (e) {}
   try { syncNoSoundTextTrainLayout(); } catch (e) {}
 }

 function bindTrainingSettingsAutoSave(){
   function onSettingsChanged(){
     if (shouldAutoSaveLastTrainingCheckpoint() || (Gl_resumeFromHistoryOnRun && Gl_aRithmLisp && Gl_aRithmLisp.length))
       scheduleAutoSaveLastTrainingCheckpoint("settings");
   }
   try {
     var ns = document.getElementById("idNoSound");
     if (ns && !ns._tcjsSettingsSaveBound) {
       ns._tcjsSettingsSaveBound = true;
       ns.addEventListener("change", onSettingsChanged);
     }
   } catch (e) {}
   try {
     var rateEl = document.getElementById("inputRate");
     if (rateEl && !rateEl._tcjsSettingsSaveBound) {
       rateEl._tcjsSettingsSaveBound = true;
       rateEl.addEventListener("change", onSettingsChanged);
       rateEl.addEventListener("input", onSettingsChanged);
     }
   } catch (e) {}
   try {
     var stopChk = document.getElementById("idStopSpeakIfNext");
     if (stopChk && !stopChk._tcjsSettingsSaveBound) {
       stopChk._tcjsSettingsSaveBound = true;
       stopChk.addEventListener("change", onSettingsChanged);
     }
   } catch (e) {}
 }

 function collectTrainingSessionSnapshotObject(){
   var panel = typeof getTrainingNavPanel === "function" ? getTrainingNavPanel() : null;
   var ui = readTrainingUiSettings();
   return {
     v: 2,
     savedAt: Date.now(),
     GltxtSpeek: GltxtSpeek ? GltxtSpeek.value : "",
     Gl_aRithmLisp: Gl_aRithmLisp,
     GlnInd: GlnInd,
     GlnDelta: GlnDelta,
     GlBegTime: GlBegTime ? GlBegTime.getTime() : null,
     GldPrev: GldPrev ? GldPrev.getTime() : null,
     GlflSayIntro: GlflSayIntro,
     GlflSayIntro2: GlflSayIntro2,
     Gl_State: Gl_State,
     GlIsRunning: GlIsRunning,
     Gl_IsFinished: Gl_IsFinished,
     Gl_currentTrainName: Gl_currentTrainName,
     Gl_trainTime: Gl_trainTime,
     Gl_flBegWord: Gl_flBegWord,
     Gl_PauseStartedAt: Gl_PauseStartedAt ? Gl_PauseStartedAt.getTime() : null,
     selectAllTrainIndex: selectAllTrain ? selectAllTrain.selectedIndex : -1,
     noSound: ui.noSound,
     stopSpeakIfNext: ui.stopSpeakIfNext,
     speechRate: ui.speechRate,
     textTrain: docTextTrain ? docTextTrain.value : "",
     textTime: txtTextTime ? txtTextTime.value : "",
     navScrollTop: panel ? panel.scrollTop : 0,
     stoppedAtIndex: GlnInd,
     pulseLogText: (Gl_hadHeartRateDuringTraining && hasHeartRateLogData()) ? buildHeartRateLogText() : "",
     stoppedAtExercise: (Gl_aRithmLisp && Gl_aRithmLisp[GlnInd]) ? String(Gl_aRithmLisp[GlnInd]) : ""
   };
 }

 function shouldPersistTrainingSession(){
   return (isActiveTrainingSession() || Gl_State === TXT_BTN_PAUSED) && !Gl_IsFinished
     && Gl_aRithmLisp && Gl_aRithmLisp.length > 0;
 }

 function saveTrainingSessionSnapshot(){
   if (!shouldPersistTrainingSession()) return;
   try { sessionStorage.setItem(TCJS_TRAINING_SESSION_KEY, JSON.stringify(collectTrainingSessionSnapshotObject())); } catch (e) {}
 }

 function loadSavedTrainingsList(){
   try {
     var raw = localStorage.getItem(TCJS_LAST_TRAININGS_KEY);
     if (raw) {
       var arr = JSON.parse(raw);
       if (Array.isArray(arr)) return arr;
     }
     var old = localStorage.getItem(TCJS_LAST_TRAINING_KEY);
     if (old) {
       var one = JSON.parse(old);
       if (one && one.snap) {
         localStorage.setItem(TCJS_LAST_TRAININGS_KEY, JSON.stringify([one]));
         return [one];
       }
     }
   } catch (e) {}
   return [];
 }

 function pushSavedTrainingToHistory(payload){
   if (!payload || !payload.snap) return;
   var list = loadSavedTrainingsList();
   var key = payload.sessionKey || String(payload.savedAt || "");
   if (list.length && list[0].sessionKey === key) {
     list[0] = payload;
   } else {
     list.unshift(payload);
     if (list.length > TCJS_LAST_TRAINING_MAX)
       list = list.slice(0, TCJS_LAST_TRAINING_MAX);
   }
   try {
     localStorage.setItem(TCJS_LAST_TRAININGS_KEY, JSON.stringify(list));
     localStorage.setItem(TCJS_LAST_TRAINING_KEY, JSON.stringify(list[0]));
   } catch (e) {}
   if (Gl_savedTrainingsBrowseIndex >= list.length)
     Gl_savedTrainingsBrowseIndex = 0;
 }

 function hasLastSavedTraining(){
   return loadSavedTrainingsList().length > 0;
 }

 function isTrainingExerciseNavMode(){
   return isActiveTrainingSession() || Gl_State === TXT_BTN_PAUSED;
 }

 function truncateTrainingTitle(name, maxLen){
   maxLen = maxLen || 26;
   var s = String(name || "").replace(/\s+/g, " ").trim();
   if (!s) return "";
   if (s.length <= maxLen) return s;
   return s.slice(0, maxLen - 1) + "…";
 }

 function getCurrentSavedTrainingTitle(){
   var list = loadSavedTrainingsList();
   if (!list.length) return "";
   var p = list[Gl_savedTrainingsBrowseIndex] || list[0];
   if (!p || !p.snap) return "";
   return String(p.snap.Gl_currentTrainName || "").trim();
 }

 function updateLastTrainingCenterButtonLabel(){
   var btn = document.getElementById("btnLastTraining");
   if (!btn) return;
   var short = truncateTrainingTitle(getCurrentSavedTrainingTitle(), 26);
   btn.textContent = short ? ("Прошлые тренировки (" + short + ")") : "Прошлые тренировки";
 }

 function syncPrevNextNavButtons(){
   var prevBtn = document.getElementById("btnPrev");
   var nextBtn = document.getElementById("btnNext");
   var centerBtn = document.getElementById("btnLastTraining");
   var navRow = document.getElementById("idTrainingNavRow");
   if (!prevBtn || !nextBtn) return;

   var active = isActiveTrainingSession();
   var hasHistory = hasLastSavedTraining();

   if (!active && !hasHistory) {
     if (navRow) navRow.style.display = "none";
     prevBtn.style.display = "none";
     nextBtn.style.display = "none";
     if (centerBtn) centerBtn.style.display = "none";
     return;
   }

   if (navRow) navRow.style.display = "";

   if (active) {
     prevBtn.style.display = "";
     nextBtn.style.display = "";
     if (centerBtn) centerBtn.style.display = "none";
     prevBtn.innerHTML = "&lt;&lt; предыдущее упражнение";
     nextBtn.innerHTML = "следующее упражнение &gt;&gt;";
     prevBtn.disabled = false;
     nextBtn.disabled = false;
     prevBtn.title = "";
     nextBtn.title = "";
     return;
   }

   prevBtn.style.display = "";
   nextBtn.style.display = "";
   if (centerBtn) {
     centerBtn.style.display = "";
     centerBtn.disabled = false;
     centerBtn.title = "Загрузить выбранную сохранённую тренировку и продолжить с того же упражнения";
     updateLastTrainingCenterButtonLabel();
   }
   prevBtn.innerHTML = "&lt;&lt;";
   nextBtn.innerHTML = "&gt;&gt;";
   var list = loadSavedTrainingsList();
   var i = Gl_savedTrainingsBrowseIndex;
   prevBtn.disabled = i >= list.length - 1;
   nextBtn.disabled = i <= 0;
   var pos = " (" + (i + 1) + " из " + list.length + ")";
   prevBtn.title = "Предыдущая сохранённая тренировка" + pos;
   nextBtn.title = "Следующая сохранённая тренировка" + pos;
 }

 function updateLastTrainingButtonVisibility(){
   syncPrevNextNavButtons();
 }

 function applySavedTrainingPreview(payload){
   if (!payload || !payload.snap || !payload.snap.Gl_aRithmLisp) return false;
   var snap = payload.snap;
   GltxtSpeek.value = snap.GltxtSpeek || "";
   Gl_aRithmLisp = snap.Gl_aRithmLisp;
   Gl_IsGenerated = true;
   Gl_currentTrainName = snap.Gl_currentTrainName || "";
   Gl_resumeFromHistoryOnRun = true;
   Gl_historyPreviewSnap = JSON.parse(JSON.stringify(snap));
   GlnInd = snap.stoppedAtIndex != null ? snap.stoppedAtIndex : snap.GlnInd;
   try {
     if (typeof snap.selectAllTrainIndex === "number" && snap.selectAllTrainIndex >= 0 && selectAllTrain.options.length > snap.selectAllTrainIndex)
       selectAllTrain.selectedIndex = snap.selectAllTrainIndex;
   } catch (e) {}
   applyTrainingUiSettingsFromSnap(snap);
   try {
     document.getElementById("trainPage").style.display = "block";
     document.getElementById("checkTrainPage").checked = true;
   } catch (e) {}
   try { loadHeartRatePreviewFromPayload(payload) } catch (eHr) {}
   try { initHeartRateChartWatchers() } catch (eHrW) {}
   try { refreshTrainEditorFromSelection() } catch (eHrEd) {}
   return true;
 }

 function stepSavedTrainingHistory(delta){
   var list = loadSavedTrainingsList();
   if (!list.length) return;
   var ni = Gl_savedTrainingsBrowseIndex + delta;
   if (ni < 0 || ni >= list.length) return;
   Gl_savedTrainingsBrowseIndex = ni;
   applySavedTrainingPreview(list[ni]);
   syncPrevNextNavButtons();
 }

 function shouldAutoSaveLastTrainingCheckpoint(){
   if (Gl_suppressEmergencySave) return false;
   if (!Gl_aRithmLisp || !Gl_aRithmLisp.length || Gl_IsFinished) return false;
   return isActiveTrainingSession() || Gl_State === TXT_BTN_PAUSED || GlflSayIntro;
 }

 /** opts.download=true — при «Завершить» (файл с меткой времени); false — аварийное (тот же *_last.rtm). */
 function saveLastTrainingCheckpoint(opts){
   opts = opts || {};
   var withDownload = opts.download !== false;
   if (!withDownload && !shouldAutoSaveLastTrainingCheckpoint()) return false;
   if (!Gl_aRithmLisp || !Gl_aRithmLisp.length) return false;
   var snap = collectTrainingSessionSnapshotObject();
   var rtmText = buildRtmTextFromArithmLisp(Gl_aRithmLisp, Gl_currentTrainName);
   if (!rtmText) return false;
   var base = sanitizeTrainFilename(Gl_currentTrainName);
   var rtmFilename = withDownload
     ? (base + "_last_" + new Date().yyyymmddhhmmss("_") + ".rtm")
     : (base + "_last.rtm");
   var payload = {
     v: 1,
     savedAt: Date.now(),
     saveReason: opts.reason || (withDownload ? "finish" : "auto"),
     sessionKey: (snap.GlBegTime || Date.now()) + "_" + sanitizeTrainFilename(Gl_currentTrainName),
     snap: snap,
     rtmText: rtmText,
     rtmFilename: rtmFilename
   };
   if (Gl_hadHeartRateDuringTraining && hasHeartRateLogData()) {
     payload.pulseLogText = buildHeartRateLogText();
     payload.pulseFilename = withDownload
       ? (base + "_pulse_" + new Date().yyyymmddhhmmss("_") + ".csv")
       : (base + "_pulse_last.csv");
   }
   if (withDownload && opts.reason === "finish" && !Gl_hadHeartRateDuringTraining)
     purgeStoredPulseForTrainingName(Gl_currentTrainName);
   try { pushSavedTrainingToHistory(payload); } catch (e) { return false; }
   var notifySave = withDownload && (opts.reason === "finish");
   try {
     if (withDownload) {
       if (!saveCheckpointTextFile(rtmText, rtmFilename, "text/plain", notifySave))
         download(rtmText, rtmFilename, "text/plain");
     } else {
       saveCheckpointTextFile(rtmText, rtmFilename, "text/plain", false);
     }
   } catch (e) {}
   try {
     if (Gl_hadHeartRateDuringTraining && hasHeartRateLogData())
       saveHeartRateLogFile({ download: withDownload, reason: opts.reason || "", notifySave: notifySave });
   } catch (eHr) {}
   updateLastTrainingButtonVisibility();
   return true;
 }

 function scheduleAutoSaveLastTrainingCheckpoint(reason){
   if (!shouldAutoSaveLastTrainingCheckpoint()) return;
   if (Gl_lastTrainingAutoSaveTimer) clearTimeout(Gl_lastTrainingAutoSaveTimer);
   Gl_lastTrainingAutoSaveTimer = setTimeout(function(){
     Gl_lastTrainingAutoSaveTimer = null;
     saveLastTrainingCheckpoint({ download: false, reason: reason || "auto" });
   }, 800);
 }

 function flushAutoSaveLastTrainingCheckpoint(reason){
   if (Gl_lastTrainingAutoSaveTimer) {
     clearTimeout(Gl_lastTrainingAutoSaveTimer);
     Gl_lastTrainingAutoSaveTimer = null;
   }
   if (shouldAutoSaveLastTrainingCheckpoint())
     saveLastTrainingCheckpoint({ download: false, reason: reason || "flush" });
 }

 function startLastTrainingPeriodicAutoSave(){
   stopLastTrainingPeriodicAutoSave();
   Gl_lastTrainingPeriodicTimer = setInterval(function(){
     if (shouldAutoSaveLastTrainingCheckpoint())
       saveLastTrainingCheckpoint({ download: false, reason: "interval" });
   }, 45000);
 }

 function stopLastTrainingPeriodicAutoSave(){
   if (Gl_lastTrainingPeriodicTimer) {
     clearInterval(Gl_lastTrainingPeriodicTimer);
     Gl_lastTrainingPeriodicTimer = null;
   }
 }

 function initEmergencySaveWatchers(){
   try {
     if (navigator.getBattery) {
       navigator.getBattery().then(function(bat){
         function onBatteryRisk(){
           if (!shouldAutoSaveLastTrainingCheckpoint()) return;
           var level = bat.level;
           var charging = bat.charging;
           if (charging || level > 0.2) {
             Gl_batteryLowSaveDone = false;
             return;
           }
           if (level <= 0.05) {
             flushAutoSaveLastTrainingCheckpoint("battery_critical");
             return;
           }
           if (level <= 0.15 && !Gl_batteryLowSaveDone) {
             Gl_batteryLowSaveDone = true;
             flushAutoSaveLastTrainingCheckpoint("battery_low");
           }
         }
         bat.addEventListener("levelchange", onBatteryRisk);
         bat.addEventListener("chargingchange", onBatteryRisk);
         onBatteryRisk();
       }).catch(function(){});
     }
   } catch (e) {}

   try {
     document.addEventListener("freeze", function(){
       flushAutoSaveLastTrainingCheckpoint("freeze");
     });
   } catch (e) {}

   try {
     window.addEventListener("blur", function(){
       scheduleAutoSaveLastTrainingCheckpoint("blur");
     });
   } catch (e) {}
 }

 function resumeLastSavedTraining(){
   var list = loadSavedTrainingsList();
   if (!list.length) {
     alert("Нет сохранённой прошлой тренировки.");
     return;
   }
   var payload = list[Gl_savedTrainingsBrowseIndex] || list[0];
   if (!payload || !payload.snap || !payload.snap.Gl_aRithmLisp || !payload.snap.Gl_aRithmLisp.length) {
     alert("Сохранённая тренировка повреждена или пуста.");
     return;
   }
   stopCurrentSpeech();
   stopTrainingAudioGuard();
   clearTrainingSessionSnapshot();

   var snap = payload.snap;
   snap.Gl_IsFinished = false;
   snap.Gl_State = TXT_BTN_PAUSED;
   snap.GlIsRunning = false;
   snap.GlflSayIntro = true;
   snap.GlflSayIntro2 = true;

   restoreTrainingSessionFromSnapshot(snap);

   try {
     document.getElementById("trainPage").style.display = "block";
     document.getElementById("checkTrainPage").checked = true;
     document.getElementById("calendarPage").style.display = "none";
     document.getElementById("checkCalendarPage").checked = false;
   } catch (e) {}

   var idx = snap.stoppedAtIndex != null ? snap.stoppedAtIndex : snap.GlnInd;
   if (typeof idx === "number" && idx >= 0) {
     GlnInd = idx;
     try {
       if (idx > 0) GlnDelta = calcMilliseconds(String(Gl_aRithmLisp[idx - 1]));
     } catch (e) {}
     paintTrainingNavProgress(GlnInd);
     scrollTrainingNavToProgress(false);
   }
   GldPrev = new Date();

   var ex = snap.stoppedAtExercise || (Gl_aRithmLisp[GlnInd] ? String(Gl_aRithmLisp[GlnInd]) : "");
   try { loadHeartRatePreviewFromPayload(payload) } catch (eHr) {}
   if (ex)
     alert("Загружена прошлая тренировка. Упражнение: " + ex + "\nНажмите «Продолжить», чтобы продолжить с этого места.");
   else
     alert("Загружена прошлая тренировка. Нажмите «Продолжить», чтобы продолжить.");
 }

 function scheduleSaveTrainingSessionSnapshot(){
   if (!shouldPersistTrainingSession()) return;
   if (Gl_trainingSessionSaveTimer) return;
   Gl_trainingSessionSaveTimer = setTimeout(function(){
     Gl_trainingSessionSaveTimer = null;
     saveTrainingSessionSnapshot();
     scheduleAutoSaveLastTrainingCheckpoint("periodic");
   }, 250);
 }

 function clearTrainingSessionSnapshot(){
   try { sessionStorage.removeItem(TCJS_TRAINING_SESSION_KEY); } catch (e) {}
 }

 function applyTrainingRunChrome(){
   document.getElementById("idDivCalendar").style.display = "none";
   document.getElementById("btnRecalcCal").style.display = "none";
   document.getElementById("btnImportCal").style.display = "none";
   document.getElementById("idDivActionCalendar").style.display = "none";
   document.getElementById("idDivAllTrain").style.display = "none";
   document.getElementById("idDivNavigation").style.display = "block";
   document.getElementById("idDivTextTime").style.display = "block";
   document.getElementById("selectedCalendars").style.display = "none";
   document.getElementById("checkPage").style.display = "none";
   document.getElementById("idImpExpAll").style.display = "none";
   document.getElementById("idImpExp").style.display = "none";
   syncTrainPageSetupLinksVisibility();
   initTrainingNavScrollGuard();
   try { btnSelectAllTrain.setAttribute("onclick", 'execTrain1(0,"Run")'); } catch (e) {}
 }

 function restoreTrainingSetupChrome(){
   try { document.getElementById("idDivAllTrain").style.display = ""; } catch (e) {}
   try { document.getElementById("idDivNavigation").style.display = "none"; } catch (e) {}
   try { document.getElementById("idDivTextTime").style.display = "none"; } catch (e) {}
   try { document.getElementById("idImpExpAll").style.display = ""; } catch (e) {}
   try { document.getElementById("idImpExp").style.display = ""; } catch (e) {}
   try { document.getElementById("selectedCalendars").style.display = ""; } catch (e) {}
   try { document.getElementById("checkPage").style.display = ""; } catch (e) {}
   try {
     var calOn = document.getElementById("checkCalendarPage") && document.getElementById("checkCalendarPage").checked;
     document.getElementById("idDivCalendar").style.display = calOn ? "" : "none";
     document.getElementById("btnRecalcCal").style.display = calOn ? "" : "none";
     document.getElementById("btnImportCal").style.display = calOn ? "" : "none";
     document.getElementById("idDivActionCalendar").style.display = calOn ? "" : "none";
   } catch (e) {}
   try { syncHeartRateChartVisibility(); } catch (e) {}
   syncTrainPageSetupLinksVisibility();
 }

 function beginTrainingRunSession(){
   GlIsRunning = true;
   Gl_IsFinished = false;
   Gl_PauseStartedAt = null;
   Gl_hadHeartRateDuringTraining = false;
   try {
     Gl_hrChartPreviewMode = false;
     resetHeartRateChart();
   } catch (eHr0) {}
   startTrainingAudioGuard();
   try { btnSelectAllTrain.innerHTML = "Пауза"; } catch (e) {}
   applyTrainingRunChrome();
   setTimeout(function(){ scrollTrainingNavToProgress(false); }, 0);
   try { syncHeartRateChartVisibility(); } catch (eHr1) {}
 }

 function buildTrainingNavigationList(){
   currentT.innerHTML = "";
   var nId = "";
   var prevId = "*";
   var prevText = "";
   var nRepeat = 1;
   for (var i = 1; i < Gl_aRithmLisp.length; i += 2) {
     var sDelta = Gl_aRithmLisp[i - 1];
     try { if (!(sDelta.indexOf("[") >= 0)) sDelta += " [МСЕК]"; } catch (e) { sDelta = sDelta.toString() + " [МСЕК]"; }
     if ((Gl_aRithmLisp[i] == prevText) && (prevId != "*")) {
       nRepeat += 1;
       nId = addAction("currentTShort", currentT, sDelta + "   ," + Gl_aRithmLisp[i], i, false, false, "width:100%", false, prevId, nRepeat);
     } else {
       nId = addAction("currentT", currentT, sDelta + "   ," + Gl_aRithmLisp[i], i, false, false, "width:100%", false);
       nRepeat = 1;
     }
     prevId = nId;
     prevText = Gl_aRithmLisp[i];
   }
 }

 function restoreTrainingSessionFromSnapshot(snap){
   GltxtSpeek.value = snap.GltxtSpeek || "";
   Gl_aRithmLisp = snap.Gl_aRithmLisp;
   Gl_IsGenerated = true;
   GlnInd = snap.GlnInd;
   GlnDelta = snap.GlnDelta;
   GlflSayIntro = !!snap.GlflSayIntro;
   GlflSayIntro2 = !!snap.GlflSayIntro2;
   Gl_State = snap.Gl_State || TXT_BTN_STARTED;
   GlIsRunning = !!snap.GlIsRunning;
   Gl_IsFinished = !!snap.Gl_IsFinished;
   Gl_currentTrainName = snap.Gl_currentTrainName || "";
   Gl_trainTime = snap.Gl_trainTime;
   Gl_flBegWord = !!snap.Gl_flBegWord;
   GlBegTime = snap.GlBegTime ? new Date(snap.GlBegTime) : new Date();
   GldPrev = snap.GldPrev ? new Date(snap.GldPrev) : new Date();
   Gl_PauseStartedAt = snap.Gl_PauseStartedAt ? new Date(snap.Gl_PauseStartedAt) : null;
   try {
     if (typeof snap.selectAllTrainIndex === "number" && snap.selectAllTrainIndex >= 0 && selectAllTrain.options.length > snap.selectAllTrainIndex)
       selectAllTrain.selectedIndex = snap.selectAllTrainIndex;
   } catch (e) {}
   applyTrainingUiSettingsFromSnap(snap);
   if (txtTextTime && snap.textTime) txtTextTime.value = snap.textTime;
   if (docTextTrain && snap.textTrain) docTextTrain.value = snap.textTrain;

   applyTrainingRunChrome();
   buildTrainingNavigationList();
   paintTrainingNavProgress(GlnInd);

   if (Gl_IsFinished) {
     try { btnSelectAllTrain.innerHTML = TXT_BTN_FINISHED; } catch (e) {}
     syncTrainPageSetupLinksVisibility();
     scheduleStopTrainingAudioGuard();
   } else if (Gl_State === TXT_BTN_PAUSED) {
     GlIsRunning = false;
     try { btnSelectAllTrain.innerHTML = "Продолжить"; } catch (e) {}
     syncTrainPageSetupLinksVisibility();
   } else {
     Gl_IsFinished = false;
     try { btnSelectAllTrain.innerHTML = "Пауза"; } catch (e) {}
     startTrainingAudioGuard();
     if (!Gl_SayInterval)
       Gl_SayInterval = setInterval(fSayInTime, 10);
   }

   var panel = getTrainingNavPanel();
   if (panel && typeof snap.navScrollTop === "number")
     panel.scrollTop = snap.navScrollTop;
   syncNoSoundTextTrainLayout();
   return true;
 }

 function tryRestoreTrainingSessionSnapshot(){
   var raw;
   try { raw = sessionStorage.getItem(TCJS_TRAINING_SESSION_KEY); } catch (e) { return false; }
   if (!raw) return false;
   var snap;
   try { snap = JSON.parse(raw); } catch (e) { clearTrainingSessionSnapshot(); return false; }
   if (!snap || snap.v !== 1 || !snap.Gl_aRithmLisp || !snap.Gl_aRithmLisp.length) return false;
   if (Date.now() - (snap.savedAt || 0) > 12 * 60 * 60 * 1000) {
     clearTrainingSessionSnapshot();
     return false;
   }
   if (snap.Gl_IsFinished) {
     clearTrainingSessionSnapshot();
     return false;
   }
   var ok = restoreTrainingSessionFromSnapshot(snap);
   if (ok && snap.pulseLogText)
     try { loadHeartRatePreviewFromPayload({ pulseLogText: snap.pulseLogText }) } catch (eHr) {}
   return ok;
 }

 var Gl_aFormulas = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]//глобаль для использования в формулах трень
 function fn_place(date){
   switch ((date).getDate()%8){
     case 0: return  'большая комната';
     case 1: return 'ванная';
     case 2: return  'туалет';
     case 3: return 'кухня';
     case 4: return  'маленькая комната';
     case 5: return 'коридор';
     case 6: return  'тамбур';
     case 7: return 'мастерская';
   }
 }
 var Gl_place = fn_place(new Date)
 
 //----------------------------------
 var GlnInd=0;
 var GlnDelta=0;
 var Gl_navUserBrowsing = false;
 var Gl_navBrowseTimer = null;
 var Gl_navScrollGuardReady = false;
 var Gl_navProgrammaticScroll = false;
 var Gl_flBegWord = false;
 var Gl_aRithmLisp;
 var GldPrev = new Date();
 var GlflSayIntro = false; //сказано  ввведение (сколько времени займет треня и пр.)
 var GlflSayIntro2 = false; //прошло 5000 мс с момента как начал говорить введение
 var GlIsRunning = false
 //----онлайн параметры--------------------------------------
 var _номер_итерации_=0;
 var _history_ = [];
 // _пульс_: текущий пульс (уд/мин) в формулах; -1 если нет данных
 var _пульс_ = -1;
 //-----------------------------------------------------------
 var Gl_SelectedInd=-1; //выбранная тренировка
 var Gl_aMultiCalendar
 var Gl_DaysBeforeNowForShow = 0 //выводить в календаре дела за Gl_DaysBeforeNowForShow дней до сегодняшнего
 var Gl_DaysAfterNowForShow = 1//выводить в календаре дала за Gl_DaysАfterNowForShow дней после сегодняшнего

 var GlBegTime = new Date()
 var Gl_StopSpeakIfNext = false //прерывать проговаривание сразу при наступлении следующего упра
var Gl_WakeLock = null
var Gl_WakeLockWanted = false
var Gl_AudioGuardContext = null
var Gl_AudioGuardOscillator = null
var Gl_AudioGuardGain = null
var Gl_AudioGuardTimer = null
var Gl_TrainingKeepAliveTimer = null
var Gl_AudioGuardStopTimer = null
var Gl_TRAINING_KEEPALIVE_MS = 4000
var Gl_BackgroundAudio = null
var Gl_BackgroundAudioUrl = null
var Gl_SayInterval = null
var Gl_PauseStartedAt = null

function createTrainingBackgroundAudioUrl(){
  var sampleRate = 8000
  var seconds = 20
  var samples = sampleRate * seconds
  var dataSize = samples * 2
  var buffer = new ArrayBuffer(44 + dataSize)
  var view = new DataView(buffer)

  function writeString(offset, value){
    for (var i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i))
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)

  for (var i = 0; i < samples; i++){
    var sample = Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 12)
    view.setInt16(44 + i * 2, sample, true)
  }

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }))
}

function ensureTrainingBackgroundAudio(){
  if (Gl_BackgroundAudio)
    return Gl_BackgroundAudio

  Gl_BackgroundAudioUrl = createTrainingBackgroundAudioUrl()
  Gl_BackgroundAudio = new Audio()
  Gl_BackgroundAudio.src = Gl_BackgroundAudioUrl
  Gl_BackgroundAudio.loop = true
  Gl_BackgroundAudio.preload = "auto"
  Gl_BackgroundAudio.volume = 0.03
  Gl_BackgroundAudio.setAttribute("playsinline", "playsinline")
  Gl_BackgroundAudio.style.display = "none"
  document.body.appendChild(Gl_BackgroundAudio)

  return Gl_BackgroundAudio
}

function startTrainingBackgroundAudio(){
  try{
    var audio = ensureTrainingBackgroundAudio()
    var playResult = audio.play()
    if (playResult && playResult.catch)
      playResult.catch(function(e){
        console.log("Background audio guard could not start:", e)
      })
  }catch(e){
    console.log("Background audio guard is unavailable:", e)
  }

  try{
    if ("mediaSession" in navigator){
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Тренировка",
        artist: "TotalCalendarJS",
        album: "Фоновый звук для тренировки"
      })
      navigator.mediaSession.playbackState = "playing"
      navigator.mediaSession.setActionHandler("play", function(){
        if (!resumeTrainingPlayback()){
          startTrainingBackgroundAudio()
          resumeTrainingAudio()
        }
      })
      navigator.mediaSession.setActionHandler("pause", function(){
        pauseTrainingPlayback()
      })
    }
  }catch(e){}
}

function resumeTrainingAudio(){
  try{
    if (window.speechSynthesis && window.speechSynthesis.paused)
      window.speechSynthesis.resume()
  }catch(e){}

  try{
    if (!Gl_BackgroundAudio)
      ensureTrainingBackgroundAudio()
    if (Gl_BackgroundAudio && Gl_BackgroundAudio.paused){
      var playResult = Gl_BackgroundAudio.play()
      if (playResult && playResult.catch)
        playResult.catch(function(e){
          console.log("Background audio guard could not resume:", e)
        })
    }
  }catch(e){}

  try{
    var AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (AudioContextClass && !Gl_AudioGuardContext){
      Gl_AudioGuardContext = new AudioContextClass()
      Gl_AudioGuardGain = Gl_AudioGuardContext.createGain()
      Gl_AudioGuardGain.gain.value = 0.0001
      Gl_AudioGuardOscillator = Gl_AudioGuardContext.createOscillator()
      Gl_AudioGuardOscillator.frequency.value = 1
      Gl_AudioGuardOscillator.connect(Gl_AudioGuardGain)
      Gl_AudioGuardGain.connect(Gl_AudioGuardContext.destination)
      Gl_AudioGuardOscillator.start()
    }
    if (Gl_AudioGuardContext && Gl_AudioGuardContext.state === "suspended")
      Gl_AudioGuardContext.resume()
  }catch(e){}
}

/** Поддержка wake lock, фонового аудио и AudioContext во время тренировки (в т.ч. на паузе). */
function reinforceTrainingKeepAlive(){
  if (!Gl_WakeLockWanted)
    return
  if (document.visibilityState === "visible")
    requestTrainingWakeLock()
  resumeTrainingAudio()
}

function startTrainingKeepAliveTimers(){
  if (!Gl_TrainingKeepAliveTimer)
    Gl_TrainingKeepAliveTimer = setInterval(reinforceTrainingKeepAlive, Gl_TRAINING_KEEPALIVE_MS)
}

function stopTrainingKeepAliveTimers(){
  if (Gl_TrainingKeepAliveTimer){
    clearInterval(Gl_TrainingKeepAliveTimer)
    Gl_TrainingKeepAliveTimer = null
  }
  Gl_AudioGuardTimer = null
}

function callAndroidTraining(methodName){
  try{
    if (window.AndroidTraining && typeof window.AndroidTraining[methodName] === "function"){
      var args = Array.prototype.slice.call(arguments, 1)
      window.AndroidTraining[methodName].apply(window.AndroidTraining, args)
      return true
    }
  }catch(e){
    console.log("Android training bridge error:", e)
  }

  return false
}

function isAndroidTrainingApp(){
  return !!(window.AndroidTraining)
}

/** На Android — в папку приложения без диалога; в браузере — false (только localStorage / download). */
function saveCheckpointTextFile(text, filename, mimeType, showToast){
  if (!isAndroidTrainingApp())
    return false
  if (typeof window.AndroidTraining.saveTextFileInternal !== "function")
    return false
  try {
    return !!window.AndroidTraining.saveTextFileInternal(
      String(text),
      String(filename),
      String(mimeType || "text/plain"),
      !!showToast
    )
  } catch (e) {
    return false
  }
}

function isWebBluetoothHeartRateAvailable(){
  try{
    return !!(window.isSecureContext && navigator.bluetooth && typeof navigator.bluetooth.requestDevice === "function")
  }catch(e){
    return false
  }
}

function parseWebBleHeartRate(dataView){
  try{
    if (!dataView || dataView.byteLength < 2) return -1
    var flags = dataView.getUint8(0)
    var bpm
    if (flags & 1){
      if (dataView.byteLength < 3) return -1
      bpm = dataView.getUint16(1, true)
    } else {
      bpm = dataView.getUint8(1)
    }
    if (bpm <= 0 || bpm > 250) return -1
    return bpm
  }catch(e){
    return -1
  }
}

function glWebBleHrNotifyHandler(ev){
  try{
    var dv = ev.target && ev.target.value
    if (!dv) return
    var bpm = parseWebBleHeartRate(dv)
    if (bpm > 0) onAndroidHeartRate(bpm)
  }catch(e){}
}

function onWebBleHrDisconnected(){
  try{
    if (Gl_WebBleHrChar){
      Gl_WebBleHrChar.removeEventListener("characteristicvaluechanged", glWebBleHrNotifyHandler)
      Gl_WebBleHrChar = null
    }
  }catch(e){}
  Gl_WebBleHrDevice = null
  onAndroidHeartRate(-1, "ble_disconnect")
}

function webBleHeartRateStop(){
  try{
    if (Gl_WebBleHrChar){
      Gl_WebBleHrChar.removeEventListener("characteristicvaluechanged", glWebBleHrNotifyHandler)
      Gl_WebBleHrChar.stopNotifications().catch(function(){})
      Gl_WebBleHrChar = null
    }
    if (Gl_WebBleHrDevice){
      try{
        Gl_WebBleHrDevice.removeEventListener("gattserverdisconnected", onWebBleHrDisconnected)
      }catch(e2){}
      if (Gl_WebBleHrDevice.gatt && Gl_WebBleHrDevice.gatt.connected)
        Gl_WebBleHrDevice.gatt.disconnect()
    }
  }catch(e){}
  Gl_WebBleHrDevice = null
  onAndroidHeartRate(-1, "ble_stop")
}

function showHeartRateBusyMessage(onRetry){
  var msg = "Не удалось подключиться к пульсометру.\n\n"
    + "Скорее всего он уже связан с другим телефоном, часами или велокомпьютером. "
    + "Удалённо отключить его с того устройства нельзя.\n\n"
    + "Нажмите «ОК» — повторим подключение (иногда удаётся «перехватить» соединение). "
    + "Надёжнее: отключите пульсометр в приложении на том устройстве или выключите там Bluetooth.";
  if (confirm(msg))
    onRetry()
}

async function webBleHeartRateStart(){
  if (!isWebBluetoothHeartRateAvailable()){
    alert("Пульс по Bluetooth в браузере: нужен Chrome или Edge, страница по HTTPS (или localhost), Bluetooth включён.")
    return
  }
  webBleHeartRateStop()
  try{
    var device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["heart_rate"]
    })
    var server = await device.gatt.connect()
    var service = await server.getPrimaryService("heart_rate")
    var chr = await service.getCharacteristic("heart_rate_measurement")
    await chr.startNotifications()
    chr.addEventListener("characteristicvaluechanged", glWebBleHrNotifyHandler)
    Gl_WebBleHrChar = chr
    Gl_WebBleHrDevice = device
    device.addEventListener("gattserverdisconnected", onWebBleHrDisconnected)
    updateHeartRateConnectButtonIcon()
  }catch(e){
    if (e && (e.name === "NotFoundError" || e.name === "AbortError")){
      webBleHeartRateStop()
      return
    }
    webBleHeartRateStop()
    var errText = (e && e.message) ? String(e.message) : String(e)
    if (/busy|already|connected|gatt|failed|network/i.test(errText))
      showHeartRateBusyMessage(function(){ webBleHeartRateStart() })
    else
      alert("Bluetooth: " + errText + "\n\nЕсли пульсометр занят другим устройством — отключите его там и повторите.")
  }
}

function isHeartRateSensorConnected(){
  try{
    if (typeof Gl_WebBleHrChar !== "undefined" && Gl_WebBleHrChar != null)
      return true
    if (typeof Gl_lastHeartRateBpm !== "undefined" && Gl_lastHeartRateBpm >= 0)
      return true
    return false
  }catch(e){
    return false
  }
}

function updateHeartRateConnectButtonIcon(){
  try{
    var btn = document.getElementById("btnHeartRateConnect")
    if (!btn)
      return
    var solid = btn.querySelector(".hr-heart-solid")
    var outline = btn.querySelector(".hr-heart-outline")
    var on = isHeartRateSensorConnected()
    if (solid)
      solid.style.display = on ? "inline" : "none"
    if (outline)
      outline.style.display = on ? "none" : "inline"
  }catch(e){}
  try{ syncHeartRateChartVisibility() }catch(e2){}
}

var Gl_hrChartPoints = []
var Gl_hrChartStartedAt = 0
var Gl_hrChartPreviewMode = false
var HR_CHART_WINDOW_MS = 10 * 60 * 1000
var HR_CHART_MAX_POINTS = 1200
/** Зоны пульса на графике (ориентир: 50 лет). */
var HR_CHART_ZONES_50 = [
  { lo: 120, hi: 130, band: "rgba(187, 247, 208, 0.55)", line: "#4ade80" },
  { lo: 130, hi: 140, band: "rgba(254, 249, 195, 0.6)", line: "#eab308" },
  { lo: 140, hi: 150, band: "rgba(254, 215, 170, 0.6)", line: "#f97316" },
  { lo: 150, hi: 160, band: "rgba(254, 202, 202, 0.6)", line: "#ef4444" },
  { lo: 160, hi: 250, band: "rgba(233, 213, 255, 0.6)", line: "#a855f7" }
]
var Gl_hrChartRedrawTimer = null
var Gl_hrChartResizeBound = false

function heartRateZoneLineColor(bpm){
  var v = Number(bpm)
  if (!isFinite(v))
    return "#64748b"
  if (v >= 160)
    return HR_CHART_ZONES_50[4].line
  if (v >= 150)
    return HR_CHART_ZONES_50[3].line
  if (v >= 140)
    return HR_CHART_ZONES_50[2].line
  if (v >= 130)
    return HR_CHART_ZONES_50[1].line
  if (v >= 120)
    return HR_CHART_ZONES_50[0].line
  return "#64748b"
}

function drawHeartRateChartZoneBands(ctx, yAt, padL, padT, plotW, yMin, yMax){
  for (var zi = 0; zi < HR_CHART_ZONES_50.length; zi++){
    var z = HR_CHART_ZONES_50[zi]
    var zLo = Math.max(z.lo, yMin)
    var zHi = Math.min(z.hi, yMax)
    if (zHi <= zLo)
      continue
    var yTop = yAt(zHi)
    var yBot = yAt(zLo)
    ctx.fillStyle = z.band
    ctx.fillRect(padL, yTop, plotW, yBot - yTop)
  }
}

function isHeartRateLogEnabled(){
  try{
    return isActiveTrainingSession()
  }catch(e){
    return false
  }
}

function hasHeartRateLogData(){
  return !!(Gl_hrChartPoints && Gl_hrChartPoints.length)
}

function buildHeartRateLogText(){
  if (!hasHeartRateLogData())
    return ""
  var lines = []
  lines.push("# TotalCalendarJS pulse log")
  lines.push("# training: " + String(Gl_currentTrainName || "").trim())
  if (GlBegTime)
    lines.push("# started: " + new Date(GlBegTime).toISOString())
  lines.push("# saved: " + new Date().toISOString())
  lines.push("timestamp_ms,elapsed_sec,bpm")
  var t0 = Gl_hrChartStartedAt || Gl_hrChartPoints[0].t
  for (var i = 0; i < Gl_hrChartPoints.length; i++){
    var p = Gl_hrChartPoints[i]
    var elapsed = ((p.t - t0) / 1000).toFixed(1)
    lines.push(p.t + "," + elapsed + "," + p.bpm)
  }
  return lines.join("\n")
}

/** opts.download=true — файл с меткой времени; false — перезапись *_pulse_last.csv (аварийное). */
function saveHeartRateLogFile(opts){
  opts = opts || {}
  if (!hasHeartRateLogData())
    return false
  var text = buildHeartRateLogText()
  if (!text)
    return false
  var withDownload = opts.download !== false
  var base = sanitizeTrainFilename(Gl_currentTrainName)
  var filename = withDownload
    ? (base + "_pulse_" + new Date().yyyymmddhhmmss("_") + ".csv")
    : (base + "_pulse_last.csv")
  try{
    if (withDownload) {
      if (!saveCheckpointTextFile(text, filename, "text/csv", !!opts.notifySave))
        download(text, filename, "text/csv")
    } else {
      saveCheckpointTextFile(text, filename, "text/csv", false)
    }
  }catch(e){
    return false
  }
  return true
}

function parseHeartRateLogText(text){
  var points = []
  if (!text)
    return points
  var lines = String(text).split(/\r?\n/)
  for (var i = 0; i < lines.length; i++){
    var line = lines[i].trim()
    if (!line || line.charAt(0) === "#")
      continue
    if (/^timestamp_ms/i.test(line))
      continue
    var parts = line.split(",")
    if (parts.length < 2)
      continue
    var bpm = Math.round(Number(parts[parts.length - 1]))
    var t = Number(parts[0])
    if (!isFinite(t) || !isFinite(bpm) || bpm <= 0)
      continue
    points.push({ t: t, bpm: bpm })
  }
  return points
}

function getPulseLogTextFromPayload(payload){
  if (!payload)
    return ""
  if (payload.pulseLogText)
    return String(payload.pulseLogText)
  if (payload.snap && payload.snap.pulseLogText)
    return String(payload.snap.pulseLogText)
  return ""
}

function normalizeTrainingDisplayName(name){
  return String(name || "").trim().replace(/^<|>$/g, "").replace(/\s+/g, " ").trim()
}

function trainingNamesEqual(a, b){
  var na = normalizeTrainingDisplayName(a).toLowerCase()
  var nb = normalizeTrainingDisplayName(b).toLowerCase()
  return !!(na && nb && na === nb)
}

function stripPulseFromHistoryEntry(entry){
  if (!entry)
    return
  delete entry.pulseLogText
  delete entry.pulseFilename
  if (entry.snap)
    delete entry.snap.pulseLogText
}

function deleteStoredPulseCheckpointFile(filename){
  if (!filename)
    return
  if (isAndroidTrainingApp() && typeof window.AndroidTraining.deleteCheckpointFile === "function") {
    try { window.AndroidTraining.deleteCheckpointFile(String(filename)) } catch (e) {}
    return
  }
}

function purgeStoredPulseForTrainingName(trainName){
  if (!normalizeTrainingDisplayName(trainName))
    return
  var list = loadSavedTrainingsList()
  var changed = false
  for (var i = 0; i < list.length; i++) {
    var e = list[i]
    if (!e || !e.snap)
      continue
    if (!trainingNamesEqual(e.snap.Gl_currentTrainName, trainName))
      continue
    if (!getPulseLogTextFromPayload(e))
      continue
    stripPulseFromHistoryEntry(e)
    changed = true
  }
  if (changed) {
    try {
      localStorage.setItem(TCJS_LAST_TRAININGS_KEY, JSON.stringify(list))
      if (list.length)
        localStorage.setItem(TCJS_LAST_TRAINING_KEY, JSON.stringify(list[0]))
    } catch (e) {}
  }
  deleteStoredPulseCheckpointFile(sanitizeTrainFilename(trainName) + "_pulse_last.csv")
  if (Gl_hrChartPreviewMode && trainingNamesEqual(getCurrentSavedTrainingTitle(), trainName)) {
    resetHeartRateChart()
    syncHeartRateChartVisibility()
  }
}

function loadHeartRatePreviewFromPayload(payload){
  var pulseText = getPulseLogTextFromPayload(payload)
  if (!pulseText){
    if (!isHeartRateLogEnabled())
      resetHeartRateChart()
    else
      syncHeartRateChartVisibility()
    return false
  }
  var pts = parseHeartRateLogText(pulseText)
  if (!pts.length){
    if (!isHeartRateLogEnabled())
      resetHeartRateChart()
    else
      syncHeartRateChartVisibility()
    return false
  }
  Gl_hrChartPoints = pts
  Gl_hrChartStartedAt = pts[0].t
  Gl_hrChartPreviewMode = true
  syncHeartRateChartVisibility()
  return true
}

function shouldShowHeartRateChart(){
  if (Gl_hrChartPreviewMode && hasHeartRateLogData())
    return true
  if (!isHeartRateLogEnabled())
    return false
  return isHeartRateSensorConnected()
    && typeof Gl_lastHeartRateBpm !== "undefined"
    && Gl_lastHeartRateBpm > 0
}

function syncHeartRateChartVisibility(){
  var sec = document.getElementById("idHeartRateChartSection")
  if (!sec)
    return
  var show = shouldShowHeartRateChart()
  sec.style.display = show ? "block" : "none"
  if (!show)
    return
  ensureHeartRateChartCanvasSize()
  drawHeartRateChart()
}

function resetHeartRateChart(){
  Gl_hrChartPoints = []
  Gl_hrChartStartedAt = 0
  Gl_hrChartPreviewMode = false
  var cap = document.getElementById("idHeartRateChartCaption")
  if (cap)
    cap.textContent = ""
  try{
    var canvas = document.getElementById("idHeartRateChartCanvas")
    if (canvas){
      var ctx = canvas.getContext("2d")
      if (ctx)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }catch(e){}
}

function recordHeartRateChartPoint(bpm){
  if (!isHeartRateLogEnabled())
    return
  if (Gl_hrChartPreviewMode)
    Gl_hrChartPreviewMode = false
  var v = Math.round(Number(bpm))
  if (!isFinite(v) || v <= 0)
    return
  var now = Date.now()
  if (!Gl_hrChartStartedAt)
    Gl_hrChartStartedAt = now
  Gl_hrChartPoints.push({ t: now, bpm: v })
  var cutoff = now - HR_CHART_WINDOW_MS
  while (Gl_hrChartPoints.length && Gl_hrChartPoints[0].t < cutoff)
    Gl_hrChartPoints.shift()
  if (Gl_hrChartPoints.length > HR_CHART_MAX_POINTS)
    Gl_hrChartPoints = Gl_hrChartPoints.slice(-HR_CHART_MAX_POINTS)
  syncHeartRateChartVisibility()
  scheduleHeartRateChartRedraw()
}

function scheduleHeartRateChartRedraw(){
  if (Gl_hrChartRedrawTimer)
    return
  Gl_hrChartRedrawTimer = requestAnimationFrame(function(){
    Gl_hrChartRedrawTimer = null
    if (shouldShowHeartRateChart())
      drawHeartRateChart()
  })
}

function ensureHeartRateChartCanvasSize(){
  var canvas = document.getElementById("idHeartRateChartCanvas")
  var wrap = canvas && canvas.parentElement
  if (!canvas || !wrap)
    return
  var dpr = window.devicePixelRatio || 1
  var w = Math.max(280, wrap.clientWidth || 800)
  var h = Math.max(160, wrap.clientHeight || 220)
  var cw = Math.round(w * dpr)
  var ch = Math.round(h * dpr)
  if (canvas.width !== cw || canvas.height !== ch){
    canvas.width = cw
    canvas.height = ch
  }
}

function formatHeartRateChartClock(ms){
  var d = new Date(ms)
  var h = d.getHours()
  var m = d.getMinutes()
  var s = d.getSeconds()
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s
}

function drawHeartRateChart(){
  if (!shouldShowHeartRateChart())
    return
  var canvas = document.getElementById("idHeartRateChartCanvas")
  var cap = document.getElementById("idHeartRateChartCaption")
  if (!canvas)
    return
  ensureHeartRateChartCanvasSize()
  var ctx = canvas.getContext("2d")
  if (!ctx)
    return
  var dpr = window.devicePixelRatio || 1
  var W = canvas.width
  var H = canvas.height
  var padL = 52 * dpr
  var padR = 14 * dpr
  var padT = 14 * dpr
  var padB = 34 * dpr
  var plotW = Math.max(1, W - padL - padR)
  var plotH = Math.max(1, H - padT - padB)
  ctx.clearRect(0, 0, W, H)

  var pts = Gl_hrChartPoints
  var now = Date.now()
  var tMax = now
  var tMin
  if (Gl_hrChartPreviewMode && pts.length){
    tMin = pts[0].t - 1000
    tMax = pts[pts.length - 1].t
  } else {
    tMin = Math.max((Gl_hrChartStartedAt || now) - HR_CHART_WINDOW_MS, tMax - HR_CHART_WINDOW_MS)
    if (pts.length){
      tMin = Math.max(tMin, pts[0].t - 1000)
      tMax = Math.max(tMax, pts[pts.length - 1].t)
    }
  }
  if (tMax - tMin < 60000)
    tMin = tMax - 60000

  var yMin = 50
  var yMax = 180
  if (pts.length){
    for (var i = 0; i < pts.length; i++){
      if (pts[i].bpm < yMin)
        yMin = pts[i].bpm
      if (pts[i].bpm > yMax)
        yMax = pts[i].bpm
    }
    yMin = Math.max(40, Math.floor((yMin - 8) / 10) * 10)
    yMax = Math.min(220, Math.ceil((yMax + 8) / 10) * 10)
    if (yMax - yMin < 20){
      yMin = Math.max(40, yMin - 10)
      yMax = yMin + 30
    }
  }

  function xAt(t){
    return padL + ((t - tMin) / (tMax - tMin)) * plotW
  }
  function yAt(bpm){
    return padT + plotH - ((bpm - yMin) / (yMax - yMin)) * plotH
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(padL, padT, plotW, plotH)
  ctx.clip()
  drawHeartRateChartZoneBands(ctx, yAt, padL, padT, plotW, yMin, yMax)
  ctx.restore()

  ctx.strokeStyle = "rgba(100, 116, 139, 0.35)"
  ctx.lineWidth = 1 * dpr
  ctx.font = (11 * dpr) + "px system-ui, sans-serif"
  ctx.fillStyle = "rgba(100, 116, 139, 0.9)"
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  for (var gy = yMin; gy <= yMax; gy += 10){
    var yy = yAt(gy)
    ctx.beginPath()
    ctx.moveTo(padL, yy)
    ctx.lineTo(padL + plotW, yy)
    ctx.stroke()
    ctx.fillText(String(gy), padL - 6 * dpr, yy)
  }

  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  var tMarks = 5
  for (var mi = 0; mi <= tMarks; mi++){
    var tm = tMin + ((tMax - tMin) * mi) / tMarks
    var xm = xAt(tm)
    ctx.beginPath()
    ctx.moveTo(xm, padT)
    ctx.lineTo(xm, padT + plotH)
    ctx.stroke()
    ctx.fillText(formatHeartRateChartClock(tm), xm, padT + plotH + 6 * dpr)
  }

  if (pts.length >= 1){
    ctx.lineWidth = 2 * dpr
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    if (pts.length === 1){
      var pOnly = pts[0]
      ctx.fillStyle = heartRateZoneLineColor(pOnly.bpm)
      ctx.beginPath()
      ctx.arc(xAt(pOnly.t), yAt(pOnly.bpm), 4 * dpr, 0, Math.PI * 2)
      ctx.fill()
    } else {
      for (var pi = 1; pi < pts.length; pi++){
        var p0 = pts[pi - 1]
        var p1 = pts[pi]
        ctx.strokeStyle = heartRateZoneLineColor((p0.bpm + p1.bpm) / 2)
        ctx.beginPath()
        ctx.moveTo(xAt(p0.t), yAt(p0.bpm))
        ctx.lineTo(xAt(p1.t), yAt(p1.bpm))
        ctx.stroke()
      }
      var last = pts[pts.length - 1]
      ctx.fillStyle = heartRateZoneLineColor(last.bpm)
      ctx.beginPath()
      ctx.arc(xAt(last.t), yAt(last.bpm), 4 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (cap){
    var lastBpm = pts.length ? pts[pts.length - 1].bpm : Gl_lastHeartRateBpm
    if (Gl_hrChartPreviewMode)
      cap.textContent = "Сохранённый пульс · " + pts.length + " точек · последнее: " + lastBpm + " уд/мин"
    else
      cap.textContent = "Сейчас: " + lastBpm + " уд/мин · окно " + Math.round((tMax - tMin) / 60000) + " мин"
  }
}

function initHeartRateChartWatchers(){
  if (Gl_hrChartResizeBound)
    return
  Gl_hrChartResizeBound = true
  window.addEventListener("resize", function(){
    if (shouldShowHeartRateChart())
      scheduleHeartRateChartRedraw()
  })
  syncHeartRateChartVisibility()
}

function heartRateSensorStart(){
  if (window.AndroidTraining && typeof window.AndroidTraining.startHeartRateSensor === "function"){
    callAndroidTraining("startHeartRateSensor")
    return
  }
  webBleHeartRateStart()
}

function heartRateSensorStop(){
  if (window.AndroidTraining && typeof window.AndroidTraining.stopHeartRateSensor === "function"){
    callAndroidTraining("stopHeartRateSensor")
    return
  }
  webBleHeartRateStop()
}

function stopCurrentSpeech(){
  callAndroidTraining("stopSpeech")

  try{
    if (window.speechSynthesis)
      window.speechSynthesis.cancel()
  }catch(e){}
}

function speakWithAndroidTraining(str){
  var rate = 1

  try{
    rate = Number(document.getElementById("inputRate").value) || 1
  }catch(e){}

  return callAndroidTraining("speak", String(str), rate)
}

function getSelectedTrainingNameForLink(){
  try{
    if (selectAllTrain && selectAllTrain.selectedIndex >= 0){
      var selectedTrainingName = selectAllTrain.options[selectAllTrain.selectedIndex].text.trim()
      if (selectedTrainingName.charAt(0) === "<" && selectedTrainingName.charAt(selectedTrainingName.length - 1) === ">")
        selectedTrainingName = selectedTrainingName.substring(1, selectedTrainingName.length - 1)
      return selectedTrainingName
    }
  }catch(e){}

  return ""
}

function updateOpenAndroidAppLink(){
  var link = document.getElementById("openAndroidAppLink")
  if (!link)
    return

  if (window.AndroidTraining){
    link.style.display = "none"
    initAndroidHeartRateUi()
    return
  }

  var selectedTrainingName = getSelectedTrainingNameForLink()
  if (!selectedTrainingName){
    link.style.display = "none"
    return
  }

  link.href = "totalcalendarjs://open?startwith=" + encodeURIComponent(forURL(selectedTrainingName, "String->URL"))
  link.style.display = "block"
}

function syncAndroidNoSoundMode(){
  try{
    var noSoundInput = document.getElementById("idNoSound")
    callAndroidTraining("setNoSoundMode", !!(noSoundInput && noSoundInput.checked))
  }catch(e){}
}

/** Ширина самой длинной строки (canvas), шрифт как у textarea */
function measureMaxTextLineWidthForNoSound(text, fontCss) {
  try {
    var c = measureMaxTextLineWidthForNoSound._cv || document.createElement("canvas");
    measureMaxTextLineWidthForNoSound._cv = c;
    var ctx = c.getContext("2d");
    if (!ctx) return 0;
    ctx.font = fontCss;
    var lines = String(text).replace(/\r\n/g, "\n").split("\n");
    var w = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].length ? lines[i] : " ";
      var lw = ctx.measureText(line).width;
      if (lw > w) w = lw;
    }
    return w;
  } catch (e) {
    return 0;
  }
}

/** Высота «одного экрана» для панели текста без звука (viewport, не весь документ). */
function noSoundTextTrainViewportHeight() {
  try {
    if (window.visualViewport && typeof window.visualViewport.height === "number" && window.visualViewport.height > 0)
      return Math.floor(window.visualViewport.height);
  } catch (e) { /* ignore */ }
  var h = window.innerHeight;
  return (typeof h === "number" && h > 0) ? Math.floor(h) : 600;
}

/**
 * Режим «без звука»: панель скрыта без текста; ширина min(колонка, текст).
 * Высота: по полному тексту, если он короче экрана; если длиннее — окно не меньше высоты экрана, прокрутка внутри.
 * Прокрутка содержимого — к началу.
 */
function syncNoSoundTextTrainLayout() {
  var shell = document.getElementById("idTextTrainShell");
  var ta = document.getElementById("idTextTrain");
  var ns = document.getElementById("idNoSound");
  if (!shell || !ta || !ns) return;

  if (!ns.checked) {
    shell.classList.add("text-train-shell--hidden");
    ta.style.display = "none";
    ta.style.minHeight = "";
    ta.style.maxHeight = "";
    return;
  }

  if (!String(ta.value || "").trim()) {
    shell.classList.add("text-train-shell--hidden");
    ta.style.display = "none";
    ta.style.minHeight = "";
    ta.style.maxHeight = "";
    return;
  }

  shell.classList.remove("text-train-shell--hidden");
  ta.style.display = "block";

  var cs = window.getComputedStyle(ta);
  var font = cs.font && cs.font.length ? cs.font : ((cs.fontStyle || "normal") + " " + (cs.fontWeight || "normal") + " " + cs.fontSize + " " + (cs.fontFamily || "sans-serif"));
  var padL = parseFloat(cs.paddingLeft) || 0;
  var padR = parseFloat(cs.paddingRight) || 0;
  var borderL = parseFloat(cs.borderLeftWidth) || 0;
  var borderR = parseFloat(cs.borderRightWidth) || 0;
  var padX = padL + padR + borderL + borderR;

  var maxPage = Math.min(1180, Math.max(0, window.innerWidth - 32));
  var textW = measureMaxTextLineWidthForNoSound(ta.value, font);
  var targetW = Math.ceil(textW + padX + 6);
  if (targetW < 64) targetW = 64;
  if (targetW > maxPage) targetW = maxPage;

  ta.style.width = targetW + "px";
  ta.style.maxWidth = maxPage + "px";

  ta.style.minHeight = "";
  ta.style.maxHeight = "";
  ta.style.height = "auto";
  var contentH = ta.scrollHeight;
  var vh = noSoundTextTrainViewportHeight();

  if (contentH <= vh) {
    ta.style.height = contentH + "px";
    ta.style.minHeight = "";
    ta.style.maxHeight = "";
  } else {
    ta.style.height = vh + "px";
    ta.style.minHeight = vh + "px";
    ta.style.maxHeight = vh + "px";
  }

  if (!isActiveTrainingSession())
    ta.scrollTop = 0;
}

function onNoSoundCheckboxClick() {
  syncAndroidNoSoundMode();
  var ns = document.getElementById("idNoSound");
  if (ns && ns.checked) stopCurrentSpeech();
  syncNoSoundTextTrainLayout();
  if (shouldAutoSaveLastTrainingCheckpoint() || (Gl_resumeFromHistoryOnRun && Gl_aRithmLisp && Gl_aRithmLisp.length))
    scheduleAutoSaveLastTrainingCheckpoint("settings");
}

function initAndroidHeartRateUi(){
  try{
    var row = document.getElementById("androidHeartRateControls")
    if (!row)
      return
    var show = !!(window.AndroidTraining || isWebBluetoothHeartRateAvailable())
    row.style.display = show ? "flex" : "none"
    updateHeartRateConnectButtonIcon()
    initHeartRateChartWatchers()
  }catch(e){}
}

function startTrainingAudioGuard(){
  Gl_WakeLockWanted = true
  syncAndroidNoSoundMode()
  callAndroidTraining("startTrainingGuard")
  clearTimeout(Gl_AudioGuardStopTimer)
  Gl_AudioGuardStopTimer = null

  requestTrainingWakeLock()
  startTrainingBackgroundAudio()
  resumeTrainingAudio()
  startTrainingKeepAliveTimers()
  startLastTrainingPeriodicAutoSave()
}

function scheduleStopTrainingAudioGuard(){
  if (Gl_AudioGuardStopTimer)
    return

  Gl_AudioGuardStopTimer = setTimeout(function(){
    Gl_AudioGuardStopTimer = null
    stopTrainingAudioGuard()
  }, 5000)
}

function finishTrainingPlayback(){
  Gl_IsFinished = true
  GlIsRunning = false
  Gl_evalParamOverrides = null
  clearTrainingSessionSnapshot()

  try{
    btnSelectAllTrain.innerHTML = TXT_BTN_FINISHED
  }catch(e){}

  try {
    saveLastTrainingCheckpoint({ download: true, reason: "finish" })
  } catch (eCk) {}
  try { resetHeartRateChart() } catch (eHr2) {}
  syncTrainPageSetupLinksVisibility()
  scheduleStopTrainingAudioGuard()
}

function stopTrainingAudioGuard(){
  Gl_WakeLockWanted = false
  callAndroidTraining("setNoSoundMode", false)
  callAndroidTraining("stopTrainingGuard")

  clearTimeout(Gl_AudioGuardStopTimer)
  Gl_AudioGuardStopTimer = null

  if (Gl_SayInterval){
    clearInterval(Gl_SayInterval)
    Gl_SayInterval = null
  }

  stopTrainingKeepAliveTimers()
  stopLastTrainingPeriodicAutoSave()

  try{
    if (Gl_BackgroundAudio){
      Gl_BackgroundAudio.pause()
      Gl_BackgroundAudio.removeAttribute("src")
      Gl_BackgroundAudio.load()
      Gl_BackgroundAudio.remove()
    }
    if (Gl_BackgroundAudioUrl) URL.revokeObjectURL(Gl_BackgroundAudioUrl)
  }catch(e){}

  Gl_BackgroundAudio = null
  Gl_BackgroundAudioUrl = null

  try{
    if ("mediaSession" in navigator)
      navigator.mediaSession.playbackState = "none"
  }catch(e){}

  try{
    if (Gl_WakeLock){
      Gl_WakeLock.release()
      Gl_WakeLock = null
    }
  }catch(e){}

  try{
    if (Gl_AudioGuardOscillator){
      Gl_AudioGuardOscillator.stop()
      Gl_AudioGuardOscillator.disconnect()
    }
    if (Gl_AudioGuardGain) Gl_AudioGuardGain.disconnect()
    if (Gl_AudioGuardContext) Gl_AudioGuardContext.close()
  }catch(e){}

  Gl_AudioGuardOscillator = null
  Gl_AudioGuardGain = null
  Gl_AudioGuardContext = null
}

function pauseTrainingPlayback(){
  if (!GlIsRunning || Gl_IsFinished)
    return false

  GlIsRunning = false
  Gl_State = TXT_BTN_PAUSED
  Gl_PauseStartedAt = new Date()

  try{
    btnSelectAllTrain.innerHTML = "Продолжить"
  }catch(e){}

  syncTrainPageSetupLinksVisibility()
  stopCurrentSpeech()
  try{
    if (Gl_BackgroundAudio && !Gl_BackgroundAudio.paused)
      Gl_BackgroundAudio.pause()
  }catch(e){}
  try{
    if (Gl_AudioGuardContext && Gl_AudioGuardContext.state === "running")
      Gl_AudioGuardContext.suspend()
  }catch(e){}
  if (Gl_SayInterval){
    clearInterval(Gl_SayInterval)
    Gl_SayInterval = null
  }
  saveTrainingSessionSnapshot()
  scheduleAutoSaveLastTrainingCheckpoint("pause")
  return true
}

function resumeTrainingPlayback(){
  if (Gl_State !== TXT_BTN_PAUSED || Gl_IsFinished)
    return false

  var now = new Date()
  if (Gl_PauseStartedAt){
    var pauseMs = now - Gl_PauseStartedAt
    if (!isNaN(pauseMs) && pauseMs > 0){
      GlBegTime = new Date(GlBegTime.getTime() + pauseMs)
      GldPrev = new Date(GldPrev.getTime() + pauseMs)
    }
  }
  Gl_PauseStartedAt = null

  GlIsRunning = true
  Gl_State = TXT_BTN_STARTED

  try{
    btnSelectAllTrain.innerHTML = "Пауза"
  }catch(e){}

  syncTrainPageSetupLinksVisibility()
  startTrainingAudioGuard()
  if (!Gl_SayInterval)
    Gl_SayInterval = setInterval(fSayInTime,10)

  scheduleSaveTrainingSessionSnapshot()
  return true
}

function exitTrainingApp(){
  Gl_suppressEmergencySave = true
  try { callAndroidTraining("stopTrainingGuard") } catch (e) {}
  if (isActiveTrainingSession() || Gl_State === TXT_BTN_PAUSED || (Gl_aRithmLisp && Gl_aRithmLisp.length && GlflSayIntro)) {
    if (!saveLastTrainingCheckpoint({ download: true, reason: "finish" }))
      alert("Не удалось сохранить тренировку (ритм .rtm).");
  }
  restartTrainingApp()
}

function restartTrainingApp(){
  GlIsRunning = false
  Gl_IsFinished = true
  Gl_State = TXT_BTN_FINISHED
  Gl_PauseStartedAt = null
  Gl_resumeFromHistoryOnRun = false
  Gl_historyPreviewSnap = null
  clearTrainingSessionSnapshot()
  try { resetHeartRateChart() } catch (eHr) {}
  try { syncHeartRateChartVisibility() } catch (eHr2) {}

  stopTrainingAudioGuard()
  stopCurrentSpeech()

  if (!callAndroidTraining("restartApp"))
    window.location.reload()
}

async function requestTrainingWakeLock(){
  if (!Gl_WakeLockWanted || !("wakeLock" in navigator) || document.visibilityState !== "visible")
    return

  try{
    if (!Gl_WakeLock){
      Gl_WakeLock = await navigator.wakeLock.request("screen")
      Gl_WakeLock.addEventListener("release", function(){
        Gl_WakeLock = null
        if (Gl_WakeLockWanted && document.visibilityState === "visible")
          setTimeout(requestTrainingWakeLock, 1000)
      }, { once: true })
    }
  }catch(e){
    console.log("Screen Wake Lock is unavailable:", e)
  }
}

document.addEventListener("visibilitychange", function(){
  if (document.visibilityState === "hidden") {
    saveTrainingSessionSnapshot();
    flushAutoSaveLastTrainingCheckpoint("hidden");
  }
  if (!Gl_WakeLockWanted)
    return
  if (document.visibilityState === "visible"){
    syncAndroidNoSoundMode()
    callAndroidTraining("startTrainingGuard")
    requestTrainingWakeLock()
  }
  reinforceTrainingKeepAlive()
})

window.addEventListener("focus", function(){
  if (Gl_WakeLockWanted)
    reinforceTrainingKeepAlive()
})

window.addEventListener("pageshow", function(){
  if (Gl_WakeLockWanted)
    reinforceTrainingKeepAlive()
})

 /*Проверки (д.б) и формат
 заглавные буквы - не листья , строчные - листья
 зарезервированы ,#[]  +BEGIN EVAL PARAMETERS +END EVAL PARAMETERS 777
 */

  var GlTest = 1;
  var GltxtSpeek  = document.getElementById("idTextsToSpeek");
  var GlUtterance = (typeof SpeechSynthesisUtterance !== "undefined") ? new SpeechSynthesisUtterance("") : null;
  var calendar = document.getElementById("actionsInCalendar");
  var currentT = document.getElementById("currentT");
  var inputMinDay = document.getElementById("inputMinDay");
  var inputMaxDay = document.getElementById("inputMaxDay");
  var getTextToPrint = document.getElementById("getTextToPrint");
  var selectAllTrain = document.getElementById("selectAllTrain");
  var btnSelectAllTrain = document.getElementById("btnSelectAllTrain");
  var txtTextTime  = document.getElementById("idTextTime");
  var docTextTrain = document.getElementById("idTextTrain");
  var docNoSound = document.getElementById("idNoSound");
  var Gl_NoSoundLayoutTimer = null;
  Gl_DaysBeforeNowForShow = inputMinDay.value;
  Gl_DaysAfterNowForShow = inputMaxDay.value;
  var inputFilterStr = document.getElementById('filterStr');
  var Gl_currentTrainName =""
  var Gl_SelectedIndex= -1
  var Gl_sNameExToReplaceByUserAnswer = ""

  //todo сюда же -зарезервированные символы (можно эти имена сделать числами - индексами одногшо массива зарезервированных слов)
  //     использовать для проверок текстов на наличие зарезерв слов
  var Gl_sDelim = '/DELIMITER/'
  var Gl_sSimultTrain='[ОДНОВРЕМЕННО С]'
  var Gl_sNextTrain='[ДАЛЕЕ ДЕЛАТЬ]'

  var Gl_txtPrint = { value: '' };
  var Gl_calendarVisible = true;//false;
  //длЯ задержки начала тренировки (чтобы закрепить смартфон после нажатия стартовой кнопки)
  var GlnDelay = 0;
  var glTxtSay="1";
  var Gl_trainTime
  /** Последний BPM с Android BLE; -1 — нет данных */
  var Gl_lastHeartRateBpm = -1
  var Gl_WebBleHrDevice = null
  var Gl_WebBleHrChar = null
  var Gl_decodeExternalCallValue=""
  
  try {
    function onTrainingViewportChange(){
      if (Gl_NoSoundLayoutTimer) clearTimeout(Gl_NoSoundLayoutTimer);
      Gl_NoSoundLayoutTimer = setTimeout(syncNoSoundTextTrainLayout, 140);
      scheduleSaveTrainingSessionSnapshot();
    }
    window.addEventListener("resize", onTrainingViewportChange);
    if (window.visualViewport)
      window.visualViewport.addEventListener("resize", onTrainingViewportChange);
    window.addEventListener("pagehide", function(){
      saveTrainingSessionSnapshot();
      flushAutoSaveLastTrainingCheckpoint("pagehide");
    });
    window.addEventListener("beforeunload", function(){
      flushAutoSaveLastTrainingCheckpoint("beforeunload");
    });
    window.addEventListener("offline", function(){
      scheduleAutoSaveLastTrainingCheckpoint("offline");
    });
    window.addEventListener("error", function(){
      scheduleAutoSaveLastTrainingCheckpoint("error");
    });
    window.addEventListener("unhandledrejection", function(){
      scheduleAutoSaveLastTrainingCheckpoint("unhandledrejection");
    });
    setTimeout(syncNoSoundTextTrainLayout, 0);
  } catch (e) {}

  //для замены спецсимволов 
  var GlSEqual='__instead_of_equal__' //=
  var GlSMore='__instead_of_more__' //>
  var GlSLess='__instead_of_less__' //<
  var GlSSemicol='__instead_of_semicol__' //;
  var GlSSquote='__instead_of_squot__' //'
  var GlSDquote='__instead_of_dquot__' //"
   var GlSColon='__instead_of_colon__' //"
  //...
  //
  var Gl_IsUserAnswered = true  //признак ответа пользователем на вопрос в модальном окне
  var Gl_evalParamOverrides = null
  var Gl_evalParamsOnConfirm = null
  var Gl_evalParamsOnCancel = null
  var Gl_IsGenerated = false    //признак завершения генерации ритма
  var Gl_IntervalId
  //var Gl_CountOfGenTrainRtm = 0
  //var Gl_CountOfGenCalendarRtm = 0
  
  function btnImportTrainInGenOnClick(){
    download(GltxtSpeek.value, (new Date()).getFullYear()+'_'+(new Date()).getMonth()+'_'+(new Date()).getDate()+'_'+selectAllTrain.value+'_train.gen', 'text/plain', true)
  }

  function loadFromGen(input){
      let file = input.files[0];
      let reader = new FileReader();
      reader.readAsText(file);
      reader.onload = function() {
                            var str = reader.result
                            GltxtSpeek.value = str
                        };
      reader.onerror = function() {
          console.log(reader.error);
        };
  }
  function runFromRTM(input){
      let file = input.files[0];
      let reader = new FileReader();
      reader.readAsText(file);
      reader.onload = function() {
          try{
            var str = reader.result
            Gl_aRithmLisp = str.split('\n')
            alert("Будет запущена тренировка из файла ")
            execTrain1(0,"Run")
          } catch(e){
            alert('Не удалось запустить тренировку, проверьте формат файла. (чередование строк - время(в мс), текст, начинается с времени))')
          }
        };
      reader.onerror = function() {
          console.log(reader.error);
        };
  }

  function getRemoteTrainingsGenallUrl(){
    try {
      return new URL("GenTrainsAndCalendarFromTotalCalendarJS.genall", document.baseURI || window.location.href).href;
    } catch (e) {}
    return "https://robinzgit.github.io/TotalCalendarJS/GenTrainsAndCalendarFromTotalCalendarJS.genall";
  }

  function saveLocalTrainingsGenall(text){
    try {
      if (text && String(text).trim())
        localStorage.setItem(TCJS_LOCAL_TRAININGS_KEY, String(text));
    } catch (e) {}
  }

  function readLocalTrainingsGenall(){
    try {
      return localStorage.getItem(TCJS_LOCAL_TRAININGS_KEY);
    } catch (e) {
      return null;
    }
  }

  function clearLocalTrainingsGenall(){
    try {
      localStorage.removeItem(TCJS_LOCAL_TRAININGS_KEY);
    } catch (e) {}
  }

  function clearAllTcjsLocalStorage(){
    clearLocalTrainingsGenall();
    try {
      localStorage.removeItem(TCJS_LAST_TRAINING_KEY);
      localStorage.removeItem(TCJS_LAST_TRAININGS_KEY);
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && /^tcjs_/i.test(key))
          keys.push(key);
      }
      for (var j = 0; j < keys.length; j++)
        localStorage.removeItem(keys[j]);
    } catch (e) {}
    clearTrainingSessionSnapshot();
    try {
      var sessionKeys = [];
      for (var si = 0; si < sessionStorage.length; si++) {
        var sk = sessionStorage.key(si);
        if (sk && /^tcjs_/i.test(sk))
          sessionKeys.push(sk);
      }
      for (var sj = 0; sj < sessionKeys.length; sj++)
        sessionStorage.removeItem(sessionKeys[sj]);
    } catch (e2) {}
  }

  function resetTcjsHeartRateUiState(){
    if (typeof Gl_lastHeartRateBpm !== "undefined")
      Gl_lastHeartRateBpm = -1;
    Gl_hadHeartRateDuringTraining = false;
    Gl_savedTrainingsBrowseIndex = 0;
    Gl_historyPreviewSnap = null;
    Gl_resumeFromHistoryOnRun = false;
    try { resetHeartRateChart(); } catch (e) {}
    try { syncHeartRateChartVisibility(); } catch (e2) {}
  }

  function clearAllLocalTcjsData(){
    clearAllTcjsLocalStorage();
    resetTcjsHeartRateUiState();
    if (isAndroidTrainingApp() && typeof window.AndroidTraining.clearAllLocalFiles === "function")
      callAndroidTraining("clearAllLocalFiles");
  }

  function confirmAndClearAllLocalTcjsData(){
    if (typeof isActiveTrainingSession === "function" && isActiveTrainingSession()) {
      alert("Сначала завершите или приостановите тренировку.");
      return;
    }
    var msg = "Вы действительно хотите очистить всю историю и локально сохранённые тренировки?\n\n"
      + "Будут удалены:\n"
      + "• локальный файл тренировок (.genall);\n"
      + "• прошлые тренировки и снимки сессии;\n"
      + "• сохранённые данные пульса и файлы в папке приложения.\n\n"
      + "Страница перезагрузится; список тренировок возьмётся из встроенных данных или с сервера.";
    if (!window.confirm(msg))
      return;
    clearAllLocalTcjsData();
    alert("Локальные данные удалены.");
    window.location.reload();
  }

  function applyGenallScript(scriptText){
    if (!scriptText || !String(scriptText).trim())
      return false;
    try {
      eval(String(scriptText));
      if (!Gl_aMetaRithm || !Gl_aMetaRithm.length)
        return false;
      Gl_aMetaMetaCalendarSelected = [];
      return true;
    } catch (e) {
      console.log("applyGenallScript:", e);
      return false;
    }
  }

  function mergeTrainingCalendarsFromRithm(){
    for (var i = 0; i < Gl_aMetaRithm.length; i++) {
      try {
        if (Gl_aMetaRithm[i][2] != undefined && Gl_aMetaRithm[i][2].length > 1)
          Gl_aMetaMetaCalendar.push(Gl_aMetaRithm[i][2]);
      } catch (e) {}
    }
  }

  function fetchTrainingsGenallFromNetwork(done){
    var url = getRemoteTrainingsGenallUrl();
    fetch(url, { cache: "no-store" }).then(function(r){
      if (!r.ok)
        throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function(text){
      done(!!applyGenallScript(text));
    }).catch(function(e){
      console.log("Remote trainings .genall:", e);
      done(false);
    });
  }

  function loadTrainingsDataThen(done){
    done = done || function(){};
    var local = readLocalTrainingsGenall();
    if (local && String(local).trim()) {
      if (applyGenallScript(local)) {
        done(true);
        return;
      }
      console.log("Local trainings data failed, loading from network");
      clearLocalTrainingsGenall();
      fetchTrainingsGenallFromNetwork(done);
      return;
    }
    fetchTrainingsGenallFromNetwork(done);
  }

  function loadTrainAndCalFromFile(input){
      let file = input.files[0];
      let reader = new FileReader();
      reader.readAsText(file);
      reader.onload = function() {
          try{
            var str = reader.result
            if (!applyGenallScript(str))
              throw new Error("invalid genall");
            saveLocalTrainingsGenall(str);
            loadTrainDataWeb(true);
            alert('Загружен календарь и список тренировок')
          } catch(e){
            alert('Не удалось прочитать данные, проверьте формат файла. Должен быть js формат (без var!): "Gl-aMetaMetaCalendar=...;Gl_aMetaRithm=...;')
          }
        };
      reader.onerror = function() {
          console.log(reader.error);
        };
  }


  function downloadTrainAndCalFromFile(input){
    var sDownload = buildFullGenallScript();
    download(sDownload, (new Date()).getFullYear()+'_'+(new Date()).getMonth()+'_'+(new Date()).getDate()+'_'+'GenTrainsAndCalendarFromTotalCalendarJS.genall', 'text/plain', true)
  }
  function changePageCalendar(isCheck){
    if (isCheck)
      document.getElementById("calendarPage").style.display ='block'
    else
      document.getElementById("calendarPage").style.display ='none'
  }
  function changePageTrain(isCheck){
    if (isCheck)
      document.getElementById("trainPage").style.display ='block'
    else
      document.getElementById("trainPage").style.display ='none'
  }
  function changeSelectMode(isChecked){
    if (isChecked) {
      selectAllTrain.setAttribute("multiple","multiple")
      //alert('Вы можете выбрать несколько тренировок для одновременного выполнения, используя клавишу [CTRL].')
    } else selectAllTrain.removeAttribute("multiple")
    readFilteredListOfTrainings('',null)
  }

  function btnRecalcCalOnClick() {
    //alert(Gl_aMetaMetaCalendarSelected)
    //? Gl_calendarVisible = !Gl_calendarVisible
    //? if (Gl_calendarVisible){

      Gl_DaysBeforeNowForShow = inputMinDay.value;
      Gl_DaysAfterNowForShow = inputMaxDay.value;
      document.getElementById("idDivActionCalendar").style.height = "20px"
      fillForm()
      //? document.getElementById("btnRecalcCal").innerHTML = 'Скрыть календарь'
      //? document.getElementById("idDivActionCalendar").style.display ='inline'
    //? } else {
    //  //? document.getElementById("idDivActionCalendar").style.display ='none'
    //  document.getElementById("btnRecalcCal").innerHTML = 'Показать календарь'
    //}

  }

  function getStoredExportEmail() {
    try { return localStorage.getItem(TCJS_EXPORT_EMAIL_KEY) || ""; } catch (e) { return ""; }
  }

  function setStoredExportEmail(email) {
    try {
      if (email) localStorage.setItem(TCJS_EXPORT_EMAIL_KEY, String(email).trim());
    } catch (e) {}
  }

  function isValidExportEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function offerEmailForExportedFile(text, filename, mimeType) {
    if (!confirm("Отправить файл «" + filename + "» по электронной почте?"))
      return;
    var email = prompt("Адрес e-mail получателя:", getStoredExportEmail());
    if (email == null) return;
    email = String(email).trim();
    if (!email) return;
    if (!isValidExportEmail(email)) {
      alert("Некорректный адрес e-mail.");
      return;
    }
    setStoredExportEmail(email);
    if (tryShareExportedFileByEmail(text, filename, mimeType))
      return;
    openMailtoForExport(email, filename);
  }

  function tryShareExportedFileByEmail(text, filename, mimeType) {
    if (typeof File === "undefined" || !navigator.share) return false;
    try {
      var file = new File([text], filename, { type: mimeType || "text/plain" });
      if (navigator.canShare && !navigator.canShare({ files: [file] }))
        return false;
      navigator.share({ files: [file], title: filename }).catch(function () {});
      return true;
    } catch (e) {
      return false;
    }
  }

  function openMailtoForExport(email, filename) {
    var subject = encodeURIComponent("Total Calendar: " + filename);
    var body = encodeURIComponent(
      "Файл «" + filename + "» сохранён на устройстве.\n\n" +
      "Приложите его из папки «Загрузки» или из выбранного места сохранения.\n\n" +
      "— Total Calendar JS"
    );
    window.location.href = "mailto:" + encodeURIComponent(email) + "?subject=" + subject + "&body=" + body;
  }

  function download(text, filename, type, offerEmailAfterSave) {
      var mimeType = type || "text/plain";
      var offerEmail = !!offerEmailAfterSave;
      // В приложении диалог «Сохранить как»; после сохранения — предложение отправить по почте (Android).
      if (isAndroidTrainingApp() && typeof window.AndroidTraining.saveTextFile === "function") {
        if (offerEmail && typeof window.AndroidTraining.saveTextFileWithEmailOffer === "function")
          callAndroidTraining("saveTextFileWithEmailOffer", String(text), String(filename), String(mimeType));
        else
          callAndroidTraining("saveTextFile", String(text), String(filename), String(mimeType));
        return;
      }

      var element = document.createElement('a');
      element.setAttribute('href', 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(text));
      element.setAttribute('download', filename);

      element.style.display = 'none';
      document.body.appendChild(element);

      element.click();

      document.body.removeChild(element);
      if (offerEmail)
        offerEmailForExportedFile(text, filename, mimeType);
  }

  function openCalendarIcsInWeb(icsText){
      try{
          var url = URL.createObjectURL(new Blob([icsText], {type: 'text/calendar'}))
          var opened = window.open(url, '_blank')
          setTimeout(function(){
              URL.revokeObjectURL(url)
          }, 60000)
          return !!opened
      }catch(e){
          return false
      }
  }

  Date.prototype.yyyymmddhhmmss = function(sBetweenDateandTime='') {
      var mm = this.getMonth() + 1; // getMonth() is zero-based
      var dd = this.getDate();
      var hh = this.getHours();
      var mmin = this.getMinutes();
      var ss = this.getSeconds();

      return [this.getFullYear(),
              (mm>9 ? '' : '0') + mm,
              (dd>9 ? '' : '0') + dd,
              sBetweenDateandTime,
              (hh>9 ? '' : '0') + hh,
              (mmin>9 ? '' : '0') + mmin,
              (ss>9 ? '' : '0') + ss
             ].join('');
  };

    Date.prototype.yyyymmdd = function() {
      var mm = this.getMonth() + 1; // getMonth() is zero-based
      var dd = this.getDate();
      return [this.getFullYear(),
              (mm>9 ? '' : '0') + mm,
              (dd>9 ? '' : '0') + dd,
             ].join('');
  };



  //выгрузить события календаря (для загрузки в Outlook Google и пр. календари)
  function btnImportCalOnClick(){
    btnRecalcCalOnClick() // если изменили период и не пересчитали
    var arrayFromList = [];

    // тянем все теги li из блока с нужным  ID
    var items = document.getElementById("actionsInCalendar").getElementsByTagName("li");
    //UID:${''+nGUID+''+i}@default
    var sAddName = ""
    var sICS =
`BEGIN:VCALENDAR
PRODID:Calendar
VERSION:2.0\n`
    //var nGUID =  (new Date()).yyyymmddhhmmss()
    for (var i = 0; i < items.length; ++i) {
      try{ sAddName = " " + Gl_aMetaRithm[getTrainIndexByName('<'+Gl_aMultiCalendar[2*i+1].trim()+'>')][2][2](Gl_aMultiCalendar[2*i])
      } catch(e) {sAddName=""}
      var nGUID = items[i].innerHTML.replaceAll('\n','').replaceAll(' ','')//+i
      nGUID = nGUID.substr(nGUID.indexOf('>')) // отсечем зависящий от i куок вначале
      sICS +=
`BEGIN:VEVENT
UID:${''+nGUID+''}@default
CLASS:PUBLIC
DESCRIPTION:https://robinzgit.github.io/TotalCalendarJS/index.html?startwith=${forURL(Gl_aMultiCalendar[2*i+1].trim(),'String->URL')}&externalcall=1
DTSTAMP;VALUE=DATE-TIME:${(new Date()).yyyymmddhhmmss('T')}
DTSTART:${Gl_aMultiCalendar[2*i].yyyymmddhhmmss('T')}
DTEND:${Gl_aMultiCalendar[2*i].yyyymmddhhmmss('T')}
SUMMARY;LANGUAGE=en-ru:${Gl_aMultiCalendar[2*i+1].trim()+sAddName}
TRANSP:TRANSPARENT
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:This is an event reminder
TRIGGER:-P0DT0H0M0S
END:VALARM
END:VEVENT\n`
    }
    sICS += 'END:VCALENDAR'
    var icsFilename = 'FromTotalCalendarJS.ics'
    if (callAndroidTraining("openCalendarIcs", sICS, icsFilename))
      return

    download(sICS, icsFilename, 'text/calendar')
    openCalendarIcsInWeb(sICS)
  }

  //экспорт тренировки в файл .rtm (кастомный формат)
  function btnImportTrainOnClick(){
      var aRithmLisp=[]
      var aSimult = []
      if (GltxtSpeek.value.indexOf(Gl_sSimultTrain)>=0){
        var arrStr = GltxtSpeek.value.split(Gl_sSimultTrain)
        for (i=0;i<arrStr.length;i++) {
          aSimult.push([[],arrStr[i].split(Gl_sDelim)])
        }
        aRithmLisp = stus(aSimult,'diff')
      }
      else
          if (GltxtSpeek.value.indexOf(Gl_sNextTrain)>=0){
            var arrStr = GltxtSpeek.value.split(Gl_sNextTrain)
            for (i=0;i<arrStr.length;i++) {
              aSimult.push([[],arrStr[i].split(Gl_sDelim)])
            }
            aRithmLisp = stus(aSimult,'add')
          }
          else aRithmLisp=getArithm(GltxtSpeek.value.split(Gl_sDelim));

      aRithmLisp[0]=4000
      aRithmLisp.forEach(v=>v=String(v).replaceAll('\n',''))

      //Gl_aRithmLisp=aRithmLisp.slice() //!!!!!!!!!!!

      var sText = buildRtmTextFromArithmLisp(aRithmLisp, Gl_currentTrainName);
      download(sText, sanitizeTrainFilename(Gl_currentTrainName) + '.rtm', 'text/plain', true)
  }


  //замена пробелов и пр в имени трени для генерации URL +обратная замена для поиска трени из URL
  function forURL(sTrainName,sMode){
    var sSpace='___space___'
    if (sMode == 'String->URL')
      return sTrainName.replaceAll(' ',sSpace)
    if (sMode == 'URL->String')
      return sTrainName.replaceAll(sSpace,' ')
  }

  /** Имя тренировки из ?startwith=… в URL (deep link / календарь). null — параметра нет. */
  function getUrlStartWithTrainName(){
    try {
      var search = location.search
      if (!search || search.length < 2) {
        var qi = location.href.indexOf('?')
        if (qi < 0)
          return null
        search = location.href.slice(qi)
      }
      var params = new URLSearchParams(search.replace(/^\?/, ''))
      if (!params.has('startwith'))
        return null
      var raw = params.get('startwith')
      if (raw == null || String(raw).trim() === '')
        return null
      return forURL(String(raw).trim(), 'URL->String')
    } catch (e) {
      try {
        var q = location.href.split('?')[1]
        if (!q)
          return null
        var part = q.split('&').filter(function (v) { return v.indexOf('startwith=') >= 0 }).join('&')
        if (!part)
          return null
        var val = part.indexOf('=') >= 0 ? part.slice(part.indexOf('=') + 1) : ''
        if (!val)
          return null
        return forURL(decodeURIComponent(val), 'URL->String')
      } catch (e2) {
        return null
      }
    }
  }

  function tryOpenAndroidAppFromStartLink(onFallback){
    if (window.AndroidTraining)
      return false

    try{
      if (!location.search || location.search.indexOf('startwith=') < 0)
        return false

      if (tryOpenAndroidAppFromStartLink.tried)
        return false
      tryOpenAndroidAppFromStartLink.tried = true

      var didFallback = false
      var fallbackTimer = setTimeout(function(){
        if (document.visibilityState !== "hidden" && !didFallback){
          didFallback = true
          onFallback()
        }
      }, 1500)

      document.addEventListener("visibilitychange", function(){
        if (document.visibilityState === "hidden")
          clearTimeout(fallbackTimer)
      }, { once: true })

      window.location.href = "totalcalendarjs://open" + location.search
      return true
    }catch(e){
      return false
    }
  }

  //Выводим данные на форму при загрузке страницы
  function loadTrainData() {
    if (tryOpenAndroidAppFromStartLink(function(){ loadTrainDataAfterSources(); }))
      return
    loadTrainDataAfterSources();
  }

  function loadTrainDataAfterSources(){
    loadTrainingsDataThen(function(fromExternal){
      loadTrainDataWeb(!!fromExternal);
    });
  }

  function loadTrainDataWeb(fromExternal) {
    document.getElementById('externalcall').style.display='none';
    if (!window.AndroidTraining){
      setTimeout(function () {
          document.getElementById('externalcall').style.display='block';
      }, 1500);
      setTimeout(function () {
          document.getElementById('externalcall').style.display='none';
      }, 5500);
    }
    if (!fromExternal)
      mergeTrainingCalendarsFromRithm();
    //
    if (Gl_aMetaMetaCalendarSelected.length==0){
      //alert('сброс выбора календарей')
      for (var i=0;i<Gl_aMetaMetaCalendar.length;i++) Gl_aMetaMetaCalendarSelected.push(true) //первоначально все календари выбраны, учитываются в общем календаре
    }
    //beep0(1000, 0.5)
    //параметр - с какую треню выбрать по умолчанию (?startwith=…)
    var urlStartWithTrain = getUrlStartWithTrainName()

    //параметр - для вызова с сервера
    var externalCallValue = location.href
    // alert(externalCallValue)
    try{
      externalCallValue = location.href.split('?')[1].split('&').filter((v)=>{return (v.indexOf('externalcall')>=0)}).join(' ').split('=')[1];
    } catch(e){ externalCallValue= ''};

    if (externalCallValue!=undefined)
      Gl_decodeExternalCallValue = decodeURIComponent(externalCallValue)
    else
      Gl_decodeExternalCallValue=''

    fillForm(urlStartWithTrain != null ? urlStartWithTrain : null)

    // Ссылка с startwith — только тренировка из URL, без подмены прошлой сохранённой
    if (urlStartWithTrain == null) {
      if (!tryRestoreTrainingSessionSnapshot()) {
        var histList = loadSavedTrainingsList();
        if (histList.length)
          applySavedTrainingPreview(histList[Gl_savedTrainingsBrowseIndex]);
      }
    } else {
      Gl_resumeFromHistoryOnRun = false
      Gl_historyPreviewSnap = null
    }

    updateLastTrainingButtonVisibility()

    initEmergencySaveWatchers()
    bindTrainingSettingsAutoSave()

    initAndroidHeartRateUi()

    //GltxtSpeek.value += "\n\n Для изменения тренировки необходимо редактировать запускаемый файл html.\n";
    if (Gl_decodeExternalCallValue.valueOf().length==0){
     //! alert("Чтобы не было перерыва в тренировке из-за выключения экрана не забудьте запустить программу типа Stay Alive (android)")
    }else{
      //!      document.getElementById('externalcall').style.display='block'
      document.getElementById("idDivCalendar").style.display ='none'
      document.getElementById("idDivCalendarBtns").style.display ='none'
      document.getElementById("idDivActionCalendar").style.display ='none'
    }
  }

  function say(str0){
        //alert(Gl_aRithmLisp);
        var str = processEvalOnlineBlocks(String(str0), "S", true)
        var sImg = '*img*'
        //если в тексте есть ссылка на картинку - показываем картинку
        try{
        document.getElementById("idImgTrain").style.display ='none'
        var aImg = str.trim().split(sImg)
        if (aImg.length>1){
          document.getElementById("idImgTrain").style.display ='block'
          document.getElementById("idImgTrain").innerHTML = ""
          str =""
          for(var i=1;i<aImg.length;i+=2) {  //МОЖНО ДОБАВЛЯТЬ НЕСКОЛЬКО ССЫЛОК НА ИЗОБРАЖЕНИЯ, просто тексты ссылок с http, разделенные хотя бы одним пробелом
              // *img*src="URL" alt="альтернативный текст"*img*
              var sURL = '<img src="'+aImg[i].replaceAll('*http*','http://').replaceAll('*https*','https://')+'" alt="" width="100%"/>'
              document.getElementById("idImgTrain").innerHTML += sURL
              if(i<aImg.length) str += aImg[i-1]  //ТЕКСТ ДЛЯ ПРОИЗНЕСЕНИЯ СОБИРАЕТСЯ МЕЖДУ ВСЕМИ ССЫЛКАМИ
          }
        }
        }catch(e){}
        str = processEvalOnlineBlocks(String(str), "S", true)

        if (!docNoSound.checked){
            if (Gl_StopSpeakIfNext) stopCurrentSpeech()
            resumeTrainingAudio()
            if (!speakWithAndroidTraining(str) && typeof SpeechSynthesisUtterance !== "undefined" && window.speechSynthesis){
                var utterance0 = new SpeechSynthesisUtterance(str);
                utterance0.rate=document.getElementById("inputRate").value;// 1.5; //скорость речи
                window.speechSynthesis.speak(utterance0);
            }
            //
        } else{
            docTextTrain.value = str
            if (docTextTrain.style.backgroundColor=='yellow')
              docTextTrain.style.backgroundColor='white'
            else
              docTextTrain.style.backgroundColor='yellow'
            docTextTrain.scrollTop = 0
            window.scrollBy(0,-100)
            syncNoSoundTextTrainLayout()
        }

        var d=new Date();
        aCurr = [d,str];
        //!! вычисляется во второй проход но тут не помешает, тк этой переменной в формуле уже нет
        //_history_.push(aCurr);
      }

  function hasOnlineCalcedParams(str){
     return ((str.indexOf('{[eval_online]')>=0)
             ||(str.indexOf('[eval_online]')>=0)
             ||(str.indexOf('_номер_итерации_')>=0)
             ||(str.indexOf('_прошло_лет_')>=0)
             ||(str.indexOf('_прошло_месяцев_')>=0)
             ||(str.indexOf('_прошло_недель_')>=0)
             ||(str.indexOf('_прошло_дней_')>=0)
             ||(str.indexOf('_прошло_часов_')>=0)
             ||(str.indexOf('_прошло_минут_')>=0)
             ||(str.indexOf('_прошло_секунд_')>=0)
             ||(str.indexOf('_прошло_милисекунд_')>=0)
             ||(str.indexOf('_пульс_')>=0)
             ||(str.indexOf('_history_')>=0)
            )
   }

   function syncOnlinePulseParam(){
     if (typeof Gl_lastHeartRateBpm !== "undefined" && Gl_lastHeartRateBpm >= 0)
       _пульс_ = Gl_lastHeartRateBpm
     else
       _пульс_ = -1
   }

   /** Для eval_online в речи: _прошло_* от реального времени с момента старта тренировки (GlBegTime), а не от статического разбора ритма. */
   function syncOnlineWallClockFromTrainingStart(){
     try{
       if (!GlBegTime || !GlflSayIntro)
         return
       var ms = Math.max(0, new Date() - GlBegTime)
       _прошло_милисекунд_ = ms
       _прошло_секунд_ = Math.floor(ms / 1000)
       _прошло_минут_ = Math.floor(ms / (1000 * 60))
       _прошло_часов_ = Math.floor(ms / (1000 * 60 * 60))
       _прошло_дней_ = Math.floor(ms / (1000 * 60 * 60 * 24))
       _прошло_недель_ = Math.floor(ms / (1000 * 60 * 60 * 24 * 7))
       _прошло_лет_ = Math.floor(ms / (1000 * 60 * 60 * 24 * 365))
       _прошло_месяцев_ = 0
     }catch(e){}
   }


   function calcInterval(sInterval){ //распарсить интервал вида <#19 [СЕК][%ДИСПЕРС]10#> или <#19 [СЕК]#>
        //дисперсия

    var sRet = sInterval;
    var nDisp=0;
        try{
          if (sRet.indexOf('[%ДИСПЕРС]')>=0)
             nDisp = Number(sRet.split('[%ДИСПЕРС]')[1]);
        }catch(e){}

        sRet = calcMilliseconds(sRet)

        if (nDisp>0){
            nDipOne = 2*(0.5-Math.random())*nDisp;
            sRet = Math.round((Number(sRet)*(100+nDipOne)/100)*100)/100;
        };

        return sRet;
   }


   /** В массиве остаётся «{[eval_online]выражение[eval_online]}» (уголки снимает finish_Gl_aRithmLisp; блок целиком маскируется от strip < >). Развёртывание только в say(). */
   function processEvalOnlineBlocks(str, nMode, flEvalOnline){
     if (typeof str !== "string") str = String(str);
     if (!flEvalOnline) return str;
     var reBlock = /\{\[eval_online\]([\s\S]*?)\[eval_online\]\}?/g;
     return str.replace(reBlock, function (_full, expr) {
       try {
         var ev = eval(unwrapSpecSymbForEval(expr));
         return (ev === undefined || ev === null) ? "" : String(ev);
       } catch (e) {
         return "0";
       }
     });
   }

   function calcEval(nMode,str,flEvalOnline){ //вычисляем вставки [eval]; { [eval_online]…} для "N" — см. processEvalOnlineBlocks; для "S" блок снимает say()
                              // nMode ="N"- число  ="S"-строка
                              // flEvalOnline === true и nMode!=="S" — развернуть { [eval_online]…} в интервале; речь — только в say()
                    var sRet;
                    var sWork = String(str);
                    if (flEvalOnline === true && nMode !== "S")
                      sWork = processEvalOnlineBlocks(sWork, nMode, true);

                    if ((sWork.indexOf('[eval]')>=0)){//нужно досчитать интервал по онлайн-параметрам
                       //разбиваем строку в массив через $, для четных индексов массива заменяем элемнт на eval(element) и собираем зново в строку уже с пустым разделителем
//alert(str)
                       var aDelta = sWork.split('[eval]');
                       for(i=1; i< aDelta.length; i+=2){
                         try{
                           // alert(aDelta[i] )
                           aDelta[i]=eval(aDelta[i]);
                         } catch(e) {aDelta[i]="0" //if(!(nMode=="S")) aDelta[i]="0" else aDelta[i]=""
                                    }
                       }

                       sRet = aDelta.join("");
                       if(!(nMode=="S")){
                         sRet=calcInterval(sRet); //!!!!
                         GlnDelta = Math.round(Number(sRet));
                       }

                     }else {
                         sRet = sWork;
                         if(!(nMode=="S")){
                             //alert(sRet)
                           sRet=calcInterval(sRet); //!!!!
                           GlnDelta = Math.round(Number(sRet));

                         }
                     }

                     return sRet;
   }

   function calcTtrainTime(aRithmLisp){
   //расчет времени трени
            try{
              var nTime = 0
              for(var i =-1; i<aRithmLisp.length-1;i=i+2)
                nTime+=calcInterval(String(aRithmLisp[i+1]))
              nTime = Math.round(1*nTime/(1000*60))/1; //10->1
            } catch(e) {nTime = -100}
            return nTime
    }

   function onAndroidHeartRate(bpm, disconnectReason){
     var n = Number(bpm)
     var wasConnected = Gl_lastHeartRateBpm >= 0
     if (!isFinite(n) || n < 0){
       Gl_lastHeartRateBpm = -1
     } else {
       Gl_lastHeartRateBpm = Math.round(n)
       Gl_hadHeartRateDuringTraining = true
       try{ recordHeartRateChartPoint(Gl_lastHeartRateBpm) }catch(eHr2){}
     }
     _пульс_ = Gl_lastHeartRateBpm
     try{
       if (txtTextTime && typeof Gl_trainTime !== "undefined" && GlBegTime){
         var dCurr = new Date()
         var dT = (dCurr - GlBegTime)
         txtTextTime.value = formatTrainingTimeLine(dT)
       }
     }catch(e){}
     updateHeartRateConnectButtonIcon()
     try{ syncHeartRateChartVisibility() }catch(eHr3){}
     if (n < 0 && (wasConnected || Gl_hadHeartRateDuringTraining) && shouldAutoSaveLastTrainingCheckpoint())
       scheduleAutoSaveLastTrainingCheckpoint(disconnectReason || "hr_disconnect")
   }

   function formatTrainingTimeLine(dT){
     var base = "Прошло:   "+Math.floor(dT/(60*1000)) + "  минут  " + (Math.floor(dT/(1000)))%60 + "  секунд из  "+Gl_trainTime+" мин."
     if (typeof Gl_lastHeartRateBpm !== "undefined" && Gl_lastHeartRateBpm >= 0)
       base += "    |    Пульс: " + Gl_lastHeartRateBpm + " уд/мин"
     return base
   }

   function fSayInTime(){
        //alert(Gl_aRithmLisp)
        if(Gl_IsFinished) {
          scheduleStopTrainingAudioGuard()
          return
        }

        var dCurr = new Date();
        if(!GlflSayIntro2)
           if((dCurr-GldPrev)>=0/*!10000*/){
               GlflSayIntro2=true;
               GldPrev = new Date();
           }
        if (!GlflSayIntro){
            GlflSayIntro=true;
            //расчет времени трени
            Gl_trainTime = calcTtrainTime(Gl_aRithmLisp);
            say('Тренировка продлится ' +Gl_trainTime+' минут');
            GlBegTime = new Date();

        } else
          if (GlflSayIntro2) {
            if (GlnInd <(Gl_aRithmLisp.length)){
              dCurr = new Date();
              var dT = (dCurr-GlBegTime)
              txtTextTime.value = formatTrainingTimeLine(dT)
              if((dCurr-GldPrev)>=GlnDelta){ //прошел требуемый интервал
                     //----онлайн параметры--------------------------------------
                     //!! вычисляется во второй проход но тут не помешает, тк этой переменной в формуле уже нет
                     _номер_итерации_+=1;
                     syncOnlinePulseParam()
                     syncOnlineWallClockFromTrainingStart()
                     //-----------------------------------------------------------
                     try{
                       document.getElementById('buttonCurrentTr' + GlnInd).style.background='green'
                     } catch(e){}
                     scrollTrainingNavToProgress(true);
                     //NEW !! ДОБАВИТЬ СЮДА АНАЛИЗ ДЕЛА С ВЫБОРОМ ДЕЛ С ПОДТВЕРЖДЕНИЕМ ПОЛЬЗОВАТЕЛЯ
                     //на форму добавить невидимый блок, в котором будут отрисовываться кнопки дел к выбору
                     //...
                     /*
                     можно в calcEval можно тут - если в Gl_aRithmLisp[GlnInd] есть код списка выбора (придумать формат, напр [выбор с подтверждением из]... имена дел..[отобразить название на форме как]..
                     ХХ - начитка кнопок дел
                     сделать видимым блок с этими кнопками
                     по нажатии кнопки выполнить (прописать в onClick  XX)
                              -оформить отдельной ф-ей - вызвать что-то типа m (выбранного дела), но без глобалей и с передаваемым парамеиром имя дела
                     получившийся массив вставить вместо Gl_aRithmLisp[GlnInd]
                     ---
                     Начать надо с этого: написать что-то типа m (выбранного дела), но без глобалей и с передаваемым парамеиром имя дела.
                                         И использовать ее в m

                     */
                     //...
                     //
                     //сказать текст текущего дела
                     Gl_aRithmLisp[GlnInd]= calcEval("S",Gl_aRithmLisp[GlnInd],true)
                     say(Gl_aRithmLisp[GlnInd]);
                     if(Gl_aRithmLisp[GlnInd]==TXT_BTN_FINISHED)
                       finishTrainingPlayback()
                     //сбросить начало отсчета отсчет времени, пересчитать текущий интервал и индекс дела
                     GldPrev = new Date();
                     syncOnlinePulseParam()
                     syncOnlineWallClockFromTrainingStart()
                     Gl_aRithmLisp[GlnInd+1]= calcEval("N",String(Gl_aRithmLisp[GlnInd+1]),true) //!!!String
                     GlnInd+=2;
                     scheduleSaveTrainingSessionSnapshot();
              }
            } else {
                GlnInd+=2;
                say("Тренировка завершена")
                finishTrainingPlayback()
            }
        }

  }

  function calcMilliseconds(str){ //расчитывает длительность промежутка типа "1 [СУТ]" в милисекундах
        if (str.indexOf('[МСЕК]')>=0) return Number(str.split('[МСЕК]')[0]) //deltaMs = Number(deltaMs.split('[МСЕК]')[0])
        else if ((str.indexOf('[СЕК]')>=0)) return Number(str.split('[СЕК]')[0])*1000
        else if ((str.indexOf('[МИН]')>=0)) return Number(str.split('[МИН]')[0])*1000*60
        else if ((str.indexOf('[ЧАС]')>=0)) return Number(str.split('[ЧАС]')[0])*1000*60*60
        else if ((str.indexOf('[СУТ]')>=0)) return Number(str.split('[СУТ]')[0])*1000*60*60*24
        else if ((str.indexOf('[НЕД]')>=0)) return Number(str.split('[НЕД]')[0])*1000*60*60*24*7
        else return Number(str)
  }

  function onSelectTrain(nInd, sName){
     Gl_resumeFromHistoryOnRun = false;
     Gl_historyPreviewSnap = null;
     var nGlInd = nInd
     if (sName!=undefined)
       nGlInd = getTrainIndexByName(sName)
     execTrain1(nGlInd,"Act")
     updateOpenAndroidAppLink()
  }

  function onSelectCalendar(nInd){
     if (nInd<0) {
         document.getElementById("selectedCalendars").options.length = 0
         for(var i=0; i<Gl_aMetaMetaCalendar.length;i++){
           var oOption =  new Option(Gl_aMetaMetaCalendar[i][1][0].split('=')[0],i)
//???@ OK if calendars are not filtered now if select is filtered !?
           oOption.selected = Gl_aMetaMetaCalendarSelected[i]
           document.getElementById("selectedCalendars").options.add( oOption )
         }
     } else{
        for(var i=0; i<document.getElementById("selectedCalendars").options.length;i++)
//???@  OK if calendars are not filtered now ???? not i !!!??  Gl_aMetaMetaCalendarSelected[i]
          Gl_aMetaMetaCalendarSelected[i]=document.getElementById("selectedCalendars").options[i].selected
        btnRecalcCalOnClick
     }

  }

  function addAction (sMode, oListbox, text, value, isDefaultSelected, isSelected,sStyle,fl,btnPrevId,nRepeat)
  {
    //document.getElementById("checkTrainPage").checked = true
    var retId=""

    if (sMode=='currentTShort'){
      btn = document.getElementById(btnPrevId)
      btn.innerHTML= text +" (повторить "+nRepeat
          +" раз)"

      retId = btnPrevId
      return retId
    }else{
      var li = document.createElement("li");
      var btn = document.createElement('button');
      var txt = document.createTextNode(text);

      btn.appendChild(txt);
      btn.setAttribute('type', 'button');
      //btn.style.height='100px';

      if(sStyle.length>0){
        if(fl) btn.setAttribute('style',sStyle+';background:yellow')
        else  btn.setAttribute('style',sStyle+';background:lightgreen')
      }
      if (sMode=='currentT') btn.setAttribute('style',sStyle)

      if (sMode=='all'){
        var oOption =  new Option(text,value);
        btnSelectAllTrain.setAttribute('onclick','execTrain1(selectAllTrain.value,"Act")'); //!! RUN
        selectAllTrain.options.add( oOption ) ;//!!!
      }else if (sMode=='calendar'){
        btn.setAttribute('onclick','execTrain1('+value+',"Calendar")');
        retId = 'buttonCalendar' + value
        btn.setAttribute('id', retId);
        try{ //добавляем высоту элемента при добавлении кнопки календаря (доходим до высоты 400 и останавливаемся)
          if (Number( document.getElementById("idDivActionCalendar").style.height.replace("px",""))<400)
            document.getElementById("idDivActionCalendar").style.height =Number(document.getElementById("idDivActionCalendar").style.height.replace("px","")) +Number(btn.style.height.replace("px","")) + "px"
        }catch(e) {}
      }else if (sMode=='currentT'){
        btn.setAttribute('onclick','navigate('+value+')');
        btn.style.background='yellow';
        btn.style.height='80px';
        retId = 'buttonCurrentTr' + value
        btn.setAttribute('id', retId);
      }

      if (sMode!='all'){
        li.appendChild(btn);
        if (isDefaultSelected) li.defaultSelected = true;
        else if (isSelected) li.selected = true;
        oListbox.appendChild(li);
      }
      return retId
    }
  }

  function readFilteredListOfTrainings(sFilt,loadTrain){
    selectAllTrain.options.length = 0
    for(var i=0; i<Gl_aMetaRithm.length; i++) {
      var flAdd = true
      if (flAdd)
        flAdd = ((sFilt.length==0)
          ||((sFilt.length>0)&&(Gl_aMetaRithm[i].join(' ').toUpperCase().indexOf(sFilt.toUpperCase())>=0))
          )
      if (flAdd && (selectAllTrain.getAttribute("multiple")=="multiple"))
        flAdd = !(Gl_aMetaRithm[i].join(' ').toUpperCase().indexOf(Gl_sSimultTrain)>=0)

      if (flAdd)
        addAction("all",null/*actions*/,Gl_aMetaRithm[i][1][0].split('=')[0],i,false,false,"width:100%",false)

    }
    if (loadTrain!==null)
      for(var i=0; i<selectAllTrain.options.length;i++)
        if (selectAllTrain.options[i].text.trim()=="<"+loadTrain.trim()+">")
          selectAllTrain.selectedIndex = i
      //selectAllTrain.selectedIndex = getTrainIndexByName("<"+loadTrain+">")
    updateOpenAndroidAppLink()
  }

  //"стусовка" тренировок из массива (может не работать, если промежутки времени зависят от онлайн-вычисляемых параметров)
  //  nMode == 'paint' - вывод календаря (и входной массив 3-мерный)
  //           'diff' - "дифференцирование", расчет промежутков времени (и входной массив 2-мерный)
  //           'add' - последовательное добавление ьренировок из массива друг за другом
  function stus(aTrains, nMode){
    //собираем все календари в один:

    //1. Собираем одномерный массив, одновременно заменяя промежутки времени на даты ("интегрирование")
    var ret_aMultiCalendar=[].slice()
    var now0 = new Date()

    var  dCurr =  now0
    var  nCurr = 0
    var aCalendar = []
    var sDeltaMs=''
    var deltaMs = 0
    for (var i=0; i<aTrains.length; i++)
      if((nMode == 'diff')||((nMode == 'paint')&&Gl_aMetaMetaCalendarSelected[i]))
      {
        if (nMode == 'paint') {
          dCurr =  aTrains[i][0][0]
          aCalendar = getArithm(aTrains[i][1])
        } else {
          dCurr =  now0
          nCurr = 0
          aCalendar = getArithm(aTrains[i][1])
        }
        for (var j=1; j<aCalendar.length-1; j=j+2){
            if (hasOnlineCalcedParams(aCalendar[j-1])){
               alert('Слияние тренировок невозможно, поскольку имеются интервалы, рассчитываемые во время выполнения ('+aCalendar[j-1]+')');
               return null;
            }
            sDeltaMs=aCalendar[j-1]
            deltaMs = calcMilliseconds(sDeltaMs)
            dCurr= new Date(dCurr.setMilliseconds(dCurr.getMilliseconds()+deltaMs));
            nCurr+=deltaMs
            var nFromNow0 = ((dCurr.getTime()- now0.getTime())/(1000*60*60*24))
            if ((nMode != 'paint')||((nFromNow0>(-Gl_DaysBeforeNowForShow-1))&&(nFromNow0<Gl_DaysAfterNowForShow))){
              if(nMode=='diff') ret_aMultiCalendar.push(nCurr); else ret_aMultiCalendar.push(new Date(dCurr));
              ret_aMultiCalendar.push(aCalendar[j])

            }
        }
      }
    //2. Сортируем пары
    for (var i=0; i<ret_aMultiCalendar.length-1; i=i+2)
        for (var j=i; j<ret_aMultiCalendar.length-1; j=j+2)
        //if (nMode=='paint'){alert (ret_aMultiCalendar[i]>ret_aMultiCalendar[j]);alert (ret_aMultiCalendar[i]);alert (ret_aMultiCalendar[j])}
            if (ret_aMultiCalendar[i]>ret_aMultiCalendar[j]){
              var d = new Date(ret_aMultiCalendar[j])
              var nd = ret_aMultiCalendar[j]
              var s = String(ret_aMultiCalendar[j+1])
              ret_aMultiCalendar[j] = ret_aMultiCalendar[i]     //??  if(nMode=='diff') ret_aMultiCalendar[j] = ret_aMultiCalendar[i]; else ret_aMultiCalendar[j] = new Date(ret_aMultiCalendar[i]);
              ret_aMultiCalendar[j+1] = String(ret_aMultiCalendar[i+1])
              ret_aMultiCalendar[i]=nd    //??  if(nMode=='diff') ret_aMultiCalendar[i]=nd; else ret_aMultiCalendar[j] = new Date(d);
              ret_aMultiCalendar[i+1] = String(s)
            }
    if (nMode == 'paint') {
        //3. Выводим отсортированные дела
        var sStyle =""
        var now = new Date()
        var dCurr = new Date(ret_aMultiCalendar[0])
        var fl= true
        for(var i=1; i<ret_aMultiCalendar.length-1; i+=2) {
           dCurrPrev = new Date(dCurr)
           dCurr = new Date(ret_aMultiCalendar[i-1]);
           if (!((dCurr.getFullYear()==dCurrPrev.getFullYear())&&(dCurr.getMonth()==dCurrPrev.getMonth())&&(dCurr.getDate()==dCurrPrev.getDate())))  fl=!fl
            sStyle ="width:100%;height:40px";
             addAction("calendar",calendar,dCurr.toLocaleString()  //!! преобразовать от даты + ...
                                +'   :    '+ret_aMultiCalendar[i] ,i,false,false,sStyle,fl);
        }
    } else {
        //3. "дифференцирование"
        var now = new Date()
        var dCurr = new Date(ret_aMultiCalendar[0])
        var dCurrPrev = new Date(dCurr)
        ret_aMultiCalendar[0]=1000
        for(var i=1; i<ret_aMultiCalendar.length-1; i+=2) {
          dCurrPrev = new Date(dCurr)
          if (i<ret_aMultiCalendar.length-1){
            dCurr = new Date(ret_aMultiCalendar[i+1]);  //!! было i-1
            var deltaT = dCurr.getTime() - dCurrPrev.getTime()
            ret_aMultiCalendar[i+1]=deltaT
          }
        }
    }
    //if (nMode =='add'){
    //}
    return ret_aMultiCalendar.slice()
  }

  function buildFullGenallScript(){
    var sDownload = "";
    sDownload += "//===== КАЛЕНДАРИ ================================\n";
    sDownload += "Gl_aMetaMetaCalendar = \n";
    sDownload += "[\n";
    for (var i = 0; i < Gl_aMetaMetaCalendar.length; i++) {
      sDownload += "  [" + "[new Date(" + Gl_aMetaMetaCalendar[i][0][0].getFullYear() + "," +
        Gl_aMetaMetaCalendar[i][0][0].getMonth() + "," +
        Gl_aMetaMetaCalendar[i][0][0].getDate() + "," +
        Gl_aMetaMetaCalendar[i][0][0].getHours() + "," +
        Gl_aMetaMetaCalendar[i][0][0].getMinutes() + "," +
        Gl_aMetaMetaCalendar[i][0][0].getSeconds() + ")],\n";
      for (var j = 1; j < Gl_aMetaMetaCalendar[i].length; j++) {
        sDownload += "    [\n";
        for (var k = 0; k < Gl_aMetaMetaCalendar[i][j].length; k++)
          sDownload += "    `" + Gl_aMetaMetaCalendar[i][j][k] + "`,\n";
        sDownload += "    ],\n";
      }
      sDownload += "  ],\n";
    }
    sDownload += "]\n\n\n";
    sDownload += "//===== ТРЕНИРОВКИ ==============================\n";
    sDownload += "Gl_aMetaRithm = \n";
    sDownload += "[\n";
    for (var ti = 0; ti < Gl_aMetaRithm.length; ti++)
      sDownload += serializeOneMetaRithmEntry(Gl_aMetaRithm[ti]);
    sDownload += "]\n";
    return sDownload;
  }

  function persistTrainingsGenallToLocal(){
    try {
      saveLocalTrainingsGenall(buildFullGenallScript());
    } catch (e) {}
  }

  function serializeOneMetaRithmEntry(entry){
    var s = "[  [],\n";
    for (var j = 1; j < entry.length; j++) {
      if (entry[j][0] && Array.isArray(entry[j][0]) && entry[j][0][0] instanceof Date) {
        var d = entry[j][0][0];
        s += "    [[new Date(" + d.getFullYear() + "," + d.getMonth() + "," + d.getDate() + "," +
          d.getHours() + "," + d.getMinutes() + "," + d.getSeconds() + ")],\n";
        for (var jj = 1; jj < entry[j].length; jj++) {
          s += "    [\n";
          for (var k = 0; k < entry[j][jj].length; k++)
            s += "    `" + entry[j][jj][k] + "`,\n";
          s += "    ],\n";
        }
        s += "    ],\n";
      } else {
        s += "    [\n";
        for (var k2 = 0; k2 < entry[j].length; k2++)
          s += "    `" + entry[j][k2] + "`,\n";
        s += "    ],\n";
      }
    }
    s += "  ],\n";
    return s;
  }

  function serializeTrainingEntryForEditor(trainIdx){
    if (trainIdx < 0 || !Gl_aMetaRithm[trainIdx])
      return "";
    return serializeOneMetaRithmEntry(Gl_aMetaRithm[trainIdx]);
  }

  function getCurrentTrainingMetaIndex(){
    if (!selectAllTrain || selectAllTrain.selectedIndex < 0)
      return -1;
    var opt = selectAllTrain.options[selectAllTrain.selectedIndex];
    if (!opt)
      return -1;
    var idx = Number(opt.value);
    return isFinite(idx) ? idx : -1;
  }

  function extractBacktickStrings(s){
    var out = [];
    var re = /`((?:\\`|[^`])*)`/gs;
    var m;
    while ((m = re.exec(s)) !== null)
      out.push(m[1].replace(/\\`/g, "`"));
    return out;
  }

  /** Без eval: скобки ( ) в тексте тренировки не ломают разбор. */
  function parseTrainingEntryFromEditor(text){
    var s = String(text || "").trim();
    if (!s)
      throw new Error("Текст пуст. Ожидается фрагмент вида:\n[  [],\n    [\n    `строка определения`,\n    ],\n  ],");

    if (!/\[\s*\]/.test(s))
      throw new Error("В начале должен быть пустой блок [  [], ...");

    var calIdx = s.search(/\[\s*\[\s*new\s+Date\s*\(/i);
    var mainPart = calIdx >= 0 ? s.slice(0, calIdx) : s;
    var calPart = calIdx >= 0 ? s.slice(calIdx) : "";

    var mainStrings = extractBacktickStrings(mainPart);
    if (!mainStrings.length)
      throw new Error("Не найдено ни одной строки в обратных кавычках ` ... `.\n\nКаждая строка определения должна быть в `кавычках`, как в экспорте .genall.");

    var entry = [[], mainStrings];

    if (calPart) {
      var dm = calPart.match(/new\s+Date\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (!dm)
        throw new Error("Блок календаря: ожидается [[new Date(год,месяц,день,час,мин,сек)], ...");
      var d = new Date(+dm[1], +dm[2], +dm[3], +dm[4], +dm[5], +dm[6]);
      var calStrings = extractBacktickStrings(calPart);
      entry.push([[d], calStrings]);
    }

    return entry;
  }

  function findTrainIndexByDisplayName(baseName){
    if (!baseName)
      return -1;
    var tag = "<" + baseName + ">";
    for (var i = 0; i < Gl_aMetaRithm.length; i++)
      for (var j = 0; j < Gl_aMetaRithm[i][1].length; j++)
        if (Gl_aMetaRithm[i][1][j].split("=")[0].trim() === tag)
          return i;
    return -1;
  }

  function syncTrainEditorDirtyState(){
    var btn = document.getElementById("btnSaveTrainEditor");
    var ta = document.getElementById("idTrainEditor");
    if (!btn || !ta)
      return;
    var dirty = Gl_trainEditorBaseline !== ta.value;
    btn.style.display = dirty ? "block" : "none";
  }

  function setTrainEditorState(text, sourceIdx, originalName, baseline){
    var ta = document.getElementById("idTrainEditor");
    if (!ta)
      return;
    ta.value = text;
    Gl_trainEditorSourceIndex = typeof sourceIdx === "number" ? sourceIdx : -1;
    Gl_trainEditorIndex = Gl_trainEditorSourceIndex;
    Gl_trainEditorOriginalName = originalName != null ? String(originalName) : "";
    Gl_trainEditorBaseline = baseline != null ? String(baseline) : text;
    syncTrainEditorDirtyState();
  }

  function loadTrainEditorForIndex(trainIdx){
    if (trainIdx < 0 || !Gl_aMetaRithm[trainIdx]) {
      setTrainEditorState("", -1, "", "");
      return;
    }
    var text = serializeTrainingEntryForEditor(trainIdx);
    var name = getTrainingDisplayNameFromEntry(Gl_aMetaRithm[trainIdx]);
    setTrainEditorState(text, trainIdx, name, text);
  }

  function refreshTrainEditorFromSelection(){
    loadTrainEditorForIndex(getCurrentTrainingMetaIndex());
  }

  function initTrainEditorUi(){
    initEvalParamsDialog();
    initTrainHelpDialog();
    var ta = document.getElementById("idTrainEditor");
    if (!ta || ta._tcjsEditorBound)
      return;
    ta._tcjsEditorBound = true;
    ta.addEventListener("input", syncTrainEditorDirtyState);
  }

  function isTrainEditorPanelOpen(){
    var panel = document.getElementById("idTrainEditorPanel");
    return !!(panel && !panel.hidden);
  }

  function showTrainEditorPanel(){
    var panel = document.getElementById("idTrainEditorPanel");
    if (panel)
      panel.hidden = false;
    revealTrainEditorBlock();
  }

  function hideTrainEditorPanel(){
    var panel = document.getElementById("idTrainEditorPanel");
    if (panel)
      panel.hidden = true;
  }

  function editCurrentTrainInEditor(ev){
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    var trainIdx = getCurrentTrainingMetaIndex();
    if (trainIdx < 0) {
      alert("Сначала выберите тренировку в списке.");
      return;
    }
    loadTrainEditorForIndex(trainIdx);
    showTrainEditorPanel();
  }

  function scrollTrainEditorTextToTop(){
    var ta = document.getElementById("idTrainEditor");
    if (!ta)
      return;
    ta.scrollTop = 0;
    ta.scrollLeft = 0;
    try {
      ta.setSelectionRange(0, 0);
    } catch (e) {}
  }

  function revealTrainEditorBlock(){
    var block = document.getElementById("idTrainEditorBlock");
    scrollTrainEditorTextToTop();
    scrollDetailsBlockIntoView(block);
    requestAnimationFrame(function(){
      scrollTrainEditorTextToTop();
      scrollDetailsBlockIntoView(block);
    });
    setTimeout(function(){
      scrollTrainEditorTextToTop();
      scrollDetailsBlockIntoView(block);
    }, 120);
    var ta = document.getElementById("idTrainEditor");
    if (ta) {
      try {
        ta.focus({ preventScroll: true });
      } catch (e) {
        ta.focus();
      }
    }
  }

  function saveTrainEditor(){
    var ta = document.getElementById("idTrainEditor");
    if (!ta)
      return;
    if (Gl_trainEditorBaseline === ta.value) {
      alert("Нет изменений для сохранения.");
      return;
    }
    var parsed;
    try {
      parsed = parseTrainingEntryFromEditor(ta.value);
    } catch (e) {
      alert("Не удалось сохранить.\n\n" + (e.message || e));
      return;
    }
    var newName = getTrainingDisplayNameFromEntry(parsed);
    if (!newName) {
      alert("Не удалось определить имя тренировки в первой строке.");
      return;
    }
    var targetIdx = -1;
    var isNew = false;
    var origName = Gl_trainEditorOriginalName || "";
    var sourceIdx = Gl_trainEditorSourceIndex;
    var nameChanged = newName !== origName;

    if (!nameChanged && sourceIdx >= 0) {
      targetIdx = sourceIdx;
      Gl_aMetaRithm[targetIdx] = parsed;
    } else if (nameChanged && sourceIdx >= 0) {
      var matchIdx = findTrainIndexByDisplayName(newName);
      if (matchIdx >= 0) {
        Gl_aMetaRithm[matchIdx] = parsed;
        targetIdx = matchIdx;
        if (sourceIdx !== matchIdx) {
          Gl_aMetaRithm.splice(sourceIdx, 1);
          if (sourceIdx < targetIdx)
            targetIdx--;
        }
      } else {
        Gl_aMetaRithm.splice(sourceIdx, 1);
        Gl_aMetaRithm.push(parsed);
        targetIdx = Gl_aMetaRithm.length - 1;
        isNew = true;
        appendTrainingCalendarToSelection(parsed);
      }
    } else {
      targetIdx = findTrainIndexByDisplayName(newName);
      if (targetIdx < 0) {
        Gl_aMetaRithm.push(parsed);
        targetIdx = Gl_aMetaRithm.length - 1;
        isNew = true;
        appendTrainingCalendarToSelection(parsed);
      } else {
        Gl_aMetaRithm[targetIdx] = parsed;
      }
    }

    Gl_trainEditorSourceIndex = targetIdx;
    Gl_trainEditorIndex = targetIdx;
    Gl_trainEditorOriginalName = newName;
    persistTrainingsGenallToLocal();
    Gl_trainEditorBaseline = ta.value;
    syncTrainEditorDirtyState();
    readFilteredListOfTrainings("", newName);
    execTrain1(targetIdx, "Act");
    hideTrainEditorPanel();
    alert(isNew ? "Тренировка добавлена в конец списка и выбрана." : "Тренировка сохранена в общем списке.");
  }

  var TCJS_DEFAULT_NEW_TRAIN_NAME = "НОВАЯ ТРЕНИРОВКА";

  function buildMinimalNewTrainingEntry(){
    var d = new Date();
    var n = TCJS_DEFAULT_NEW_TRAIN_NAME;
    return [
      [],
      [
        "<" + n + ">=<ШАГ1>;<ШАГ2>",
        "<ШАГ1>=<Начало тренировки>;<#3 [СЕК]#>",
        "<ШАГ2>=<Завершение>;<#2 [СЕК]#>",
        "//",
        "[BEGIN EVAL PARAMETERS]",
        "[END EVAL PARAMETERS]",
      ],
      [
        [d],
        [
          "<КАЛЕНДАРЬ " + n + ">=1000<РАСПИСАНИЕ>",
          "<РАСПИСАНИЕ>=<" + n + ">;<#1 [СУТ]#>",
          "[BEGIN EVAL PARAMETERS]",
          "[END EVAL PARAMETERS]",
        ],
      ],
    ];
  }

  function buildMinimalNewTrainingTemplateText(){
    return serializeOneMetaRithmEntry(buildMinimalNewTrainingEntry());
  }

  function cloneMetaRithmEntry(entry){
    var out = [[]];
    for (var j = 1; j < entry.length; j++) {
      if (entry[j][0] && Array.isArray(entry[j][0]) && entry[j][0][0] instanceof Date) {
        var d = entry[j][0][0];
        var block = [[new Date(d.getTime())], entry[j][1].slice()];
        for (var k = 2; k < entry[j].length; k++)
          block.push(entry[j][k]);
        out.push(block);
      } else {
        out.push(entry[j].slice());
      }
    }
    return out;
  }

  function renameTrainingEntryName(entry, newBaseName){
    var oldBase = getTrainingDisplayNameFromEntry(entry);
    if (!oldBase || !newBaseName)
      return entry;
    var oldTag = "<" + oldBase + ">";
    var newTag = "<" + newBaseName + ">";
    function mapStr(s){
      return String(s).split(oldTag).join(newTag);
    }
    for (var i = 0; i < entry[1].length; i++)
      entry[1][i] = mapStr(entry[1][i]);
    if (entry[2] && entry[2][1])
      for (var j = 0; j < entry[2][1].length; j++)
        entry[2][1][j] = mapStr(entry[2][1][j]);
    return entry;
  }

  function buildTrainingCopyEntry(trainIdx){
    if (trainIdx < 0 || !Gl_aMetaRithm[trainIdx])
      return null;
    var baseName = getTrainingDisplayNameFromEntry(Gl_aMetaRithm[trainIdx]);
    if (!baseName)
      return null;
    var copyName = baseName + "_kopiya";
    var entry = cloneMetaRithmEntry(Gl_aMetaRithm[trainIdx]);
    renameTrainingEntryName(entry, copyName);
    return entry;
  }

  function scrollDetailsBlockIntoView(det){
    if (!det)
      return;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        try {
          det.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
          det.scrollIntoView(true);
        }
      });
    });
  }

  function copyTrainIntoEditor(ev){
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    var trainIdx = Gl_trainEditorSourceIndex >= 0 ? Gl_trainEditorSourceIndex : getCurrentTrainingMetaIndex();
    if (trainIdx < 0) {
      alert("Сначала выберите тренировку в списке.");
      return;
    }
    var entry = buildTrainingCopyEntry(trainIdx);
    if (!entry) {
      alert("Не удалось скопировать тренировку.");
      return;
    }
    var copyName = getTrainingDisplayNameFromEntry(entry);
    var text = serializeOneMetaRithmEntry(entry);
    setTrainEditorState(text, -1, copyName, buildMinimalNewTrainingTemplateText());
    showTrainEditorPanel();
  }

  function openNewTrainTemplateInEditor(ev){
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    var text = buildMinimalNewTrainingTemplateText();
    var name = TCJS_DEFAULT_NEW_TRAIN_NAME;
    var existingIdx = findTrainIndexByDisplayName(name);
    setTrainEditorState(text, existingIdx, name, text);
    showTrainEditorPanel();
  }

  function getTrainingDisplayNameFromEntry(entry){
    try {
      return entry[1][0].split("=")[0].trim().replace(/^<|>$/g, "");
    } catch (e) {
      return "";
    }
  }

  function appendTrainingCalendarToSelection(entry){
    try {
      if (!entry[2] || entry[2].length < 2)
        return;
      Gl_aMetaMetaCalendar.push(entry[2]);
      Gl_aMetaMetaCalendarSelected.push(true);
      onSelectCalendar(-1);
    } catch (e) {}
  }

  function fillForm(loadTrain=null)
  {
    //GlTest+=1;
    calendar.innerHTML = ''
    currentT.innerHTML = ''

    //========НАЧИТКА СПИСКА ВСЕХ КАЛЕНДАРЕЙ===========
    onSelectCalendar(-1)

    //=========НАЧИТКА СПИСКА ВСЕХ ТРЕНИРОВОК===========
    readFilteredListOfTrainings('',loadTrain);

    onSelectTrain(selectAllTrain.value); //onSelectTrain(this.selectedIndex,this.options[this.selectedIndex].text)

    //собираем все календари в один:
    Gl_aMultiCalendar = stus(Gl_aMetaMetaCalendar, 'paint')
    initTrainEditorUi();
    refreshTrainEditorFromSelection();
  }

  //поиск тренировки в глобальном массиве по наименованию (в угловых скобках)
  function getTrainIndexByName(sName){
    if (sName==undefined) return 0;
    for(var i=0; i<Gl_aMetaRithm.length; i++)
      for(var j=0; j<Gl_aMetaRithm[i][1].length; j++)
            if(Gl_aMetaRithm[i][1][j].split('=')[0].trim()==sName.trim()) return i;
  }

  function test(){
    aA=[];
    for(i=12;i<14;i++) aA.push(Gl_aMetaRithm[i])
    //alert(aA)
    stus(aA, 'diff')
  }

  //<<для раскрытия скобок - первая и последняя открывающая скобка строки
  function isInAngleBrackets(str,pos){ //в угловых ли скобках символ на позиции pos строки str
     //если после pos идет > (нет < между  > И pos) - в угловых
     var indClose = str.indexOf('>',pos)
     var indOpen = str.indexOf('<',pos)
     return (indClose < indOpen) || ((indClose > 0)&&(indOpen < 0))
  }


  function fgetPosBracketOpen(str,pos){
    //проверить на рав-во ( и )
    //...TODO
    var nRet = str.indexOf('(',pos+1);
    if (nRet>=0)
      while (isInAngleBrackets(str,nRet))
        nRet = str.indexOf('(',nRet+1)
    return nRet;
  }

  function fgetPosBracketClose(str,pos){
    var nRet = pos
    var nSummaBrack = 1; //открытая скобка +1 закрытая -1, на pos - открытая скобка => =1
    while ((nSummaBrack>0)&&(nRet<str.length)){
          nRet++
          if (nRet>=str.length) return -1
          while (isInAngleBrackets(str,nRet)){
            nRet++
            if (nRet>=str.length) return -1
          }
          if (str[nRet]=='(') nSummaBrack++
          if (str[nRet]==')') nSummaBrack--
          if (nSummaBrack==0) return nRet
    }
  }
  //>>

  function splitGenLinesFromSpeek(){
    return GltxtSpeek.value.split(Gl_sDelim);
  }

  function findEvalParametersBlockRange(aGen){
    var nBeg = -1;
    var nEnd = -1;
    for (var i = 0; i < aGen.length; i++) {
      if (aGen[i].indexOf("[BEGIN EVAL PARAMETERS]") >= 0) nBeg = i + 1;
      if (aGen[i].indexOf("[END EVAL PARAMETERS]") >= 0) nEnd = i - 1;
    }
    if (nBeg < 0 || nEnd < nBeg) return null;
    return { nBeg: nBeg, nEnd: nEnd };
  }

  function parseEvalParameterLine(line){
    var s = String(line || "").trim();
    if (!s || s.indexOf("//") === 0) return null;
    var eq = s.indexOf("=");
    if (eq < 0) return null;
    var name = s.substring(0, eq).trim();
    if (name.indexOf("<") !== 0) return null;
    return { name: name, rhs: s.substring(eq + 1).trim() };
  }

  function extractEvalParameterEntries(aGen){
    var block = findEvalParametersBlockRange(aGen);
    if (!block) return [];
    var out = [];
    for (var i = block.nBeg; i <= block.nEnd; i++) {
      var p = parseEvalParameterLine(aGen[i]);
      if (p) out.push(p);
    }
    return out;
  }

  function substituteEvalRhs(rhs, valuesByName){
    var s = String(rhs);
    var names = Object.keys(valuesByName);
    names.sort(function (a, b) { return b.length - a.length; });
    for (var k = 0; k < names.length; k++) {
      var n = names[k];
      if (valuesByName[n] !== undefined)
        s = s.split(n).join(String(valuesByName[n]));
    }
    return s;
  }

  function computeEvalParameterDefaults(entries){
    var valuesByName = {};
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i].name;
      var rhs = substituteEvalRhs(entries[i].rhs, valuesByName);
      if (hasOnlineCalcedParams(rhs)) {
        valuesByName[name] = rhs;
        continue;
      }
      try {
        valuesByName[name] = String(eval(rhs));
      } catch (e) {
        valuesByName[name] = rhs;
      }
    }
    return valuesByName;
  }

  function displayNameFromEvalParam(name){
    return String(name || "").trim().replace(/^<|>$/g, "");
  }

  function closeEvalParamsOverlay(){
    var overlay = document.getElementById("idEvalParamsOverlay");
    if (overlay) overlay.hidden = true;
  }

  function abortTrainingRunAfterEvalCancel(){
    Gl_evalParamOverrides = null;
    GlIsRunning = false;
    Gl_IsGenerated = false;
    try { document.getElementById("btnSelectAllTrain").disabled = false; } catch (e) {}
    try { btnSelectAllTrain.innerHTML = TXT_BTN_NOTSTARTED; } catch (e) {}
    restoreTrainingSetupChrome();
    scheduleStopTrainingAudioGuard();
  }

  function confirmEvalParamsDialog(){
    var form = document.getElementById("idEvalParamsForm");
    if (!form) return;
    var inputs = form.querySelectorAll("input[data-eval-param-name]");
    var overrides = {};
    for (var i = 0; i < inputs.length; i++) {
      var n = inputs[i].getAttribute("data-eval-param-name");
      if (n) overrides[n] = inputs[i].value;
    }
    closeEvalParamsOverlay();
    var fn = Gl_evalParamsOnConfirm;
    Gl_evalParamsOnConfirm = null;
    Gl_evalParamsOnCancel = null;
    if (typeof fn === "function") fn(overrides);
  }

  function cancelEvalParamsDialog(){
    closeEvalParamsOverlay();
    var fn = Gl_evalParamsOnCancel;
    Gl_evalParamsOnConfirm = null;
    Gl_evalParamsOnCancel = null;
    if (typeof fn === "function") fn();
  }

  function openEvalParametersDialog(entries, defaults, onConfirm, onCancel){
    var form = document.getElementById("idEvalParamsForm");
    var overlay = document.getElementById("idEvalParamsOverlay");
    if (!form || !overlay) {
      if (typeof onConfirm === "function") onConfirm({});
      return;
    }
    Gl_evalParamsOnConfirm = onConfirm;
    Gl_evalParamsOnCancel = onCancel;
    form.innerHTML = "";
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i].name;
      var row = document.createElement("div");
      row.className = "eval-params-row";
      var label = document.createElement("label");
      label.htmlFor = "idEvalParam_" + i;
      label.textContent = displayNameFromEvalParam(name);
      var input = document.createElement("input");
      input.type = "text";
      input.id = "idEvalParam_" + i;
      input.setAttribute("data-eval-param-name", name);
      var defVal = defaults[name];
      input.value = defVal !== undefined && defVal !== null ? String(defVal) : entries[i].rhs;
      if (hasOnlineCalcedParams(entries[i].rhs))
        input.title = "Онлайн-параметр: формула с _пульс_, _прошло_минут_ и т.п.";
      row.appendChild(label);
      row.appendChild(input);
      form.appendChild(row);
    }
    overlay.hidden = false;
    var first = form.querySelector("input");
    if (first) setTimeout(function () { first.focus(); }, 0);
  }

  function maybeShowEvalParametersBeforeRun(onReady, onCancel){
    var aGen = splitGenLinesFromSpeek();
    var entries = extractEvalParameterEntries(aGen);
    if (!entries.length) {
      Gl_evalParamOverrides = null;
      if (typeof onReady === "function") onReady();
      return;
    }
    var defaults = computeEvalParameterDefaults(entries);
    openEvalParametersDialog(entries, defaults, function (overrides) {
      Gl_evalParamOverrides = overrides;
      if (typeof onReady === "function") onReady();
    }, onCancel);
  }

  function getArithm(aGen){
    Gl_IsGenerated = false
    Gl_aGenRithm = aGen

    if (Gl_IsUserAnswered)
      return getArithmOneIteration(aGen)  //!! return todo - in stus() make Gl_aCalendar analogous Gl_aRitmLisp
    else{
        Gl_IntervalId = setInterval(getArithmOneIteration(Gl_aGenRithm),1500)
        alert("setInterval "+  Gl_IntervalId)
    }
    
/*
    if (!Gl_IsGenerated && Gl_IsUserAnswered){
      alert(`5`)
      Gl_IntervalId = setInterval(getArithmOneIteration(Gl_aGenRithm) ,1500)
    }
    
    if (Gl_IsGenerated) {
      alert(Gl_IntervalId)
    }
    */
   // setTimeout( ()=>{if (Gl_IsUserAnswered && !Gl_IsGenerated) { /*alert("answered");*/getArithmOneIteration(aGen) ; } else {  /*alert(Gl_IsUserAnswered);*/ setTimeout( getArithm(aGen),200)}; },0 )

  }
  
  function replaceSpecSymb(str){
    return str.replaceAll('=',GlSEqual)
                         .replaceAll('>',GlSMore)
                         .replaceAll('<',GlSLess)
                         .replaceAll(';',GlSSemicol)
                         .replaceAll("'",GlSSquote)
                         .replaceAll('"',GlSDquote)
  }
  /** Обратно к JS перед eval() в processEvalOnlineBlocks (после replaceSpecSymb в генераторе). */
  function unwrapSpecSymbForEval(str){
    return String(str)
      .replaceAll(GlSEqual,'=')
      .replaceAll(GlSMore,'>')
      .replaceAll(GlSLess,'<')
      .replaceAll(GlSSemicol,';')
      .replaceAll(GlSSquote,"'")
      .replaceAll(GlSDquote,'"');
  }
  /** Временно убираем блоки { [eval_online]…} из строки: split('<')/split('>') в finish и замена '→<> в Gl_aGenRithm не ломают >= и кавычки внутри выражения. */
  function maskEvalOnlineBlocksForAngleStrip(s){
    if (typeof s !== "string") s = String(s);
    var parts = [];
    var t = s.replace(/\{\[eval_online\][\s\S]*?\[eval_online\]\}?/g, function (m) {
      parts.push(m);
      return "__TCJS_EVON_" + (parts.length - 1) + "__";
    });
    return { t: t, parts: parts };
  }
  function unmaskEvalOnlineBlocksForAngleStrip(t, parts) {
    var out = t;
    for (var i = 0; i < parts.length; i++)
      out = out.split("__TCJS_EVON_" + i + "__").join(parts[i]);
    return out;
  }
  //выдает массив тренировки (начинается всегда с интервала, чередуется интервал-команда)
  function getArithmOneIteration(aGen){
    
    if (Gl_IsGenerated) { 
      clearInterval(Gl_IntervalId)
      alert('clearInterval(Gl_IntervalId) '+ Gl_IntervalId)
    }
    if (Gl_IsGenerated) return
    if(!Gl_IsUserAnswered ) return
    
    document.getElementById("btnSelectAllTrain").disabled = true
    //!Gl_IsGenerated = false

    var Gl_aGenRithm00 = aGen

  	//======  ГЕНЕРАЦИЯ РИТМА Gl_aRithm ИЗ ГЕНЕРАТОРА Gl_aGenRithm  ======
    
    //замена спецсимволов в блоках [eval]
    for(var i=0; i<Gl_aGenRithm00.length; i++){
      var arr = Gl_aGenRithm00[i].split('[eval]')
      if(arr.length>1){
        for(var j=1; j<arr.length; j+=2)
          arr[j] =replaceSpecSymb(arr[j])
        Gl_aGenRithm00[i] = arr.join('[eval]')
      }  
    }

    //замена спецсимволов внутри { [eval_online]…[eval_online] } — как в блоках [eval], чтобы >=, <=, <, >, = не ломали раскрытие <…> (isInAngleBrackets / fgetPosBracket*)
    for(var i=0; i<Gl_aGenRithm00.length; i++){
      Gl_aGenRithm00[i] = Gl_aGenRithm00[i].replace(/\{\[eval_online\]([\s\S]*?)\[eval_online\](\})?/g, function (_m, inner, optBrace) {
        return '{[eval_online]' + replaceSpecSymb(inner) + '[eval_online]' + (optBrace || '');
      });
    }

    //замена двоеточий в блоках [ВЫБОР ...[КАК]
    for(var i=0; i<Gl_aGenRithm00.length; i++){
      Gl_aGenRithm00[i] = Gl_aGenRithm00[i].replaceAll('\n','')
      if((Gl_aGenRithm00[i].indexOf('[ВЫБОР')>=0)&&(Gl_aGenRithm00[i].indexOf('[КАК]')>=0)){
        Gl_aGenRithm00[i] = Gl_aGenRithm00[i].replaceAll('>:<','>'+GlSColon+'<')
        //Gl_aGenRithm00[i] = Gl_aGenRithm00[i].replaceAll(':',GlSColon)
      }
    }
    
    /*
    //замена спецсимволов внутри <>
    for(var i=0; i<Gl_aGenRithm00.length; i++){
      var arr = Gl_aGenRithm00[i].split('<')
      var sItog = ""
      if(arr.length>1){
        for(var j=0; j<arr.length; j+=1){
           var arr2 =arr[j].split('<')
           for(var j2=0; j2<arr2.length; j2+=1)
             sItog +=replaceSpecSymb(arr2[j2])
        }
        Gl_aGenRithm00[i] = sItog
      }  
    }
    */
    
    //поиск http-ссылок для картинок и замена в них спецсимволов * http:/ =
    for(var i=0; i<Gl_aGenRithm00.length; i++){
      var aHtt = ['http://','https://']
      var aHttRepl = ['*http*','*https*']
      var posBeg = -1
      var posEnd = 0
      while((Gl_aGenRithm00[i].indexOf(aHtt[0])>=0)||(Gl_aGenRithm00[i].indexOf(aHtt[1])>=0)){
      for(var k=0;k<aHtt.length;k++){
          var sHtt=aHtt[k]
          var sHttRepl = aHttRepl[k]
          if ((Gl_aGenRithm00[i].indexOf(sHtt)>=0)) {
            posBeg = Gl_aGenRithm00[i].indexOf(sHtt,posBeg+1)
            posEnd = posBeg
            for(j=posBeg;j<Gl_aGenRithm00[i].length;j++)
              if ((Gl_aGenRithm00[i][j]==" ")||(Gl_aGenRithm00[i][j]==">")){ //?????? если урл может содержать > то обрежет урл  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
                posEnd = j
                break
              }
              var sURL = Gl_aGenRithm00[i].substr(posBeg,posEnd-posBeg)
              sURL = '*img*'+sURL.replaceAll(sHtt,sHttRepl)+'*img*'
              Gl_aGenRithm00[i]=Gl_aGenRithm00[i].substr(0,posBeg)+sURL+Gl_aGenRithm00[i].substr(posEnd)
          };
      }
      }
    }

    //Удаление комментариев
    var Gl_aGenRithm0 = [];
    for(var i=0; i<Gl_aGenRithm00.length; i++){
      if (!(Gl_aGenRithm00[i].trim().indexOf('//')==0)) Gl_aGenRithm0.push(Gl_aGenRithm00[i].split("//")[0]);
    }


    var Gl_aGenRithm = Gl_aGenRithm0; //!! лишнее, осталось от старого

    //alert('после удаления комментариев \n'+Gl_aGenRithm)

    //Для обратной совместимости формата [ВЫБОР]4[ДЕЛ БЕЗ ПОВТОРЕНИЙ ИЗ]
    for(var i=0; i<Gl_aGenRithm.length; i++)
      Gl_aGenRithm[i]=Gl_aGenRithm[i].replace("[ВЫБОР ИЗ]","[ВЫБОР]1[ДЕЛ БЕЗ ПОВТОРЕНИЙ ИЗ]");


    /* не убирать, напр в ИМ появляются дела undefined, сначала разобраться с ними*/
    for(var i=0; i<Gl_aGenRithm.length; i++){ //?ОНО НАДО ВООБЩЕ ?? сначала возьмем слова в кавычках в угловые скобки (не трогать кавычки внутри { [eval_online]…})
       var qMask = maskEvalOnlineBlocksForAngleStrip(Gl_aGenRithm[i]);
       var qi = qMask.t;
       while(qi.indexOf("'")>=0){
           qi=qi.replace("'","<");
           qi=qi.replace("'",">");
       }
       Gl_aGenRithm[i]=unmaskEvalOnlineBlocksForAngleStrip(qi, qMask.parts);
       if (Gl_aGenRithm[i].trim()[Gl_aGenRithm[i].trim().length-1]==";"){ //уберем последнюю ;
           Gl_aGenRithm[i] = Gl_aGenRithm[i].trim().substr(0,Gl_aGenRithm[i].trim().length-1)
       }
    }
    /**/
    //alert('после добавления угловых скобок словам в кавычках \n'+Gl_aGenRithm)

    //Раскрытие скобок типа <A> = 3(<AA>;5(<A2>;<A3>))
    var iCurr=0;
    var flContinue = (iCurr< Gl_aGenRithm.length)
    while (flContinue){
      if(Gl_aGenRithm[iCurr].indexOf('[BEGIN EVAL PARAMETERS]')>0) break //в блоке вычисления формул свои скобки, туда не лезть!
      var posOp = 0;
      var posCl =0;
      while (posOp>=0){

        //!! слабое звено, //улучшить через регулярки - произвольное кол-во пробелов

        Gl_aGenRithm[iCurr]=Gl_aGenRithm[iCurr].replaceAll(';)',')').replaceAll(' ;)',')').replaceAll('  ;)',')')//улучшить через регулярки - произвольное кол-во пробелов
        posOp = fgetPosBracketOpen(Gl_aGenRithm[iCurr],posOp);
        posCl = fgetPosBracketClose(Gl_aGenRithm[iCurr],posOp);
        if ((posOp>=0)&&(posCl>posOp)){
          var strNewName = Gl_aGenRithm[iCurr].substring(posOp+1,posCl).replaceAll('<','ABO').replaceAll('>','ABCl').replaceAll('(','RBO').replaceAll(')','RBCl').replaceAll('[','SBO').replaceAll(']','SBCl').replaceAll('#','RESH').replaceAll(';','SEMICOL')
          var strNewVal = Gl_aGenRithm[iCurr].substring(posOp+1,posCl)
          Gl_aGenRithm[iCurr]=Gl_aGenRithm[iCurr].replaceAll('('+strNewVal+')','<'+strNewName+'>');
          Gl_aGenRithm.splice(iCurr+1,0,'<'+strNewName+'>='+strNewVal)
        }
      }
     iCurr++;
     flContinue = (iCurr< Gl_aGenRithm.length)
    }
    //alert('после раскрытия скобок типа <A> = 3(<AA>;5(<A2>;<A3>)) \n'+Gl_aGenRithm)


    //Вычисление параметров
    var nBeg = -1;
    var nEnd = -1;
    for(var i=0; i<Gl_aGenRithm.length; i++){//ищем перую и последнюю строку блока
      if (Gl_aGenRithm[i].indexOf("[BEGIN EVAL PARAMETERS]")>=0) nBeg = i+1;
      if (Gl_aGenRithm[i].indexOf("[END EVAL PARAMETERS]")>=0) nEnd = i-1;
    }

    for(var i0=nBeg; i0<=nEnd; i0++)  //Подстановки (повторение цикла N раз)
        for(var i=nEnd; i>=nBeg; i--){
            var sOld = Gl_aGenRithm[i].split("=")[0].trim();//разобрали в массив правую часть после =
            var sNew = Gl_aGenRithm[i].split("=")[1];//разобрали в массив правую часть после =
            for(var j = nEnd; j>=nBeg; j--)
                   Gl_aGenRithm[j]=Gl_aGenRithm[j].split("=")[0]+"="+Gl_aGenRithm[j].split("=")[1].split(sOld).join(sNew); //replace заменит только первое вхождение..
        }
    if (nBeg>0){
        for(var i=nBeg; i<=nEnd; i++){ //вычисление формул (! в java нужно длать иначе)
            var eqParts = Gl_aGenRithm[i].split("=");
            var paramName = eqParts[0].trim();
            var rhs = eqParts.slice(1).join("=").trim();
            if (Gl_evalParamOverrides && Gl_evalParamOverrides[paramName] !== undefined)
              rhs = String(Gl_evalParamOverrides[paramName]);
            if (hasOnlineCalcedParams(rhs))
                Gl_aGenRithm[i] = paramName + '=[eval]' + rhs + '[eval]'
            else{
                try{
                  Gl_aGenRithm[i]=paramName+"="+eval(rhs)+""
                }catch(e){
                  Gl_aGenRithm[i]=paramName+"="+rhs+""
                }
            }
        }
        Gl_aGenRithm[nBeg-1]="<"+Gl_aGenRithm[nBeg-1]+">=<__"+Gl_aGenRithm[nBeg-1]+"__>" //строка заголовка блока - приводим к стандартному виду (хотя использоваться не будет)
        Gl_aGenRithm[nEnd+1]="<"+Gl_aGenRithm[nEnd+1]+">=<__"+Gl_aGenRithm[nEnd+1]+"__>" //строка окончания заголовка блока - приводим к стандартному виду (хотя использоваться не будет)
    }

    //alert('после вычисления параметров \n'+Gl_aGenRithm)

    //Подстановка из блока параметов в основной блок
    for(var i=nBeg; i<=nEnd; i++){
        var sOld = Gl_aGenRithm[i].split("=")[0].trim();//разобрали в массив правую часть после =
        var sNew = Gl_aGenRithm[i].split("=")[1];//разобрали в массив правую часть после =
        for(var j=0; j<nBeg; j++)
            Gl_aGenRithm[j]=Gl_aGenRithm[j].split("=")[0]+"="+Gl_aGenRithm[j].split("=")[1].split(sOld).join(sNew);
    }
    // alert('после подстановки из блока параметов в основной блок \n'+Gl_aGenRithm)

    //Замена умножений N<A>
    for(var i=0; i<Gl_aGenRithm.length/*-nBeg ??*/; i++){
        if (!(Gl_aGenRithm[i].indexOf("[КАК]")>=0) &&!(Gl_aGenRithm[i].indexOf("[СПРОСИТЬ]")>=0)){
            var sI="";
            var sHead = Gl_aGenRithm[i].split("=")[0];
            var aI = Gl_aGenRithm[i].split("=")[1].split(";");//разобрали в массив правую часть после =
            for(var j=0; j<aI.length; j++){
              var sNum = aI[j].trim().split('<')[0]; //!!ПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА НА ССОТВ < >
              var sVal = '<'+aI[j].trim().split('<')[1];
              var nNum = 1;
              if (sNum.trim().length>0)
                var nNum =  Number(sNum)
              sI = sI + sVal.repeat(nNum)
              /* ! Попытка использовать вставку ИНДЕКС при повторениях - проблема - в случае вложенных скобок не работает как хотелось бы - в этом случае вообще говоря имеется несколько вложенных индексов, наверное их нужно суммировать в один
              for(var k=0;k<nNum;k++) {
                if (sVal.indexOf('[ИНДЕКС]')>=0) alert (sVal+'   k='+k)
                sI+=sVal
                sI=sI.replaceAll('[ИНДЕКС]',k+1).replaceAll('[ПОСЛЕДНИЙ ИНДЕКС]',nNum)
              }
              */
            }
            Gl_aGenRithm[i] = sHead+'='+sI;
        }
    }
   //alert('после замены умножений \n'+Gl_aGenRithm)

    //Подстановки
    /*
    Общий принцип подстановок.
    1: Ищем строку, ни один из элементов списка которой не является правой частью другой строки (в т.ч. данной строки).
    Такая строка найдется, иначе если все строки содержат в списках ссылки, то имеется цикл (доказать от противного).
      Заменяем на левую часть данной строки все вхождения ее правой части в других строках, исключаем данную строку из дальнейшено поиска и замен (повторяем 1:)
    НО
    можно просто повторить цикл подстановки строки N раз (доказать..)
    */

    for(var i0=0; i0<Gl_aGenRithm.length; i0++)  //повторение цикла N раз
        for(var i=Gl_aGenRithm.length-1; i>=0; i--){
            var sOld = Gl_aGenRithm[i].split("=")[0].trim();//разобрали в массив правую часть после =
            var sNew = Gl_aGenRithm[i].split("=")[1];//разобрали в массив правую часть после =
            for(var j = Gl_aGenRithm.length-1/*!!i-1*/; j>=0; j--){
               if ((sNew.indexOf('[КАК]')>=0) || (sNew.indexOf('[СПРОСИТЬ]')>=0) ){
    //...
               }else
                   Gl_aGenRithm[j]=Gl_aGenRithm[j].split("=")[0]+"="+Gl_aGenRithm[j].split("=")[1].split(sOld).join(sNew); //replace заменит только первое вхождение..
            }
        }

   // alert('после подстановок \n'+Gl_aGenRithm[0])


    //В самом конце подстановка дел с выбором
    for(var i0=0; i0<Gl_aGenRithm.length; i0++)  //повторение цикла N раз
        for(var i=Gl_aGenRithm.length-1; i>=0; i--){
        //
          if((Gl_aGenRithm[i].indexOf("[КАК]")>0)&&(Gl_aGenRithm[i].indexOf("[СПРОСИТЬ]")<0))
              for(var j = i-1; j>=0; j--){
                var sOld = Gl_aGenRithm[i].split("=")[0].trim();//разобрали в массив левую часть после =
                while(Gl_aGenRithm[j].indexOf(sOld)>=0){
                  var sNewChanged = fGetRandomSelected(Gl_aGenRithm[i].split("=")[1] )
                  Gl_aGenRithm[j]=Gl_aGenRithm[j].replace(sOld,sNewChanged);//заменим только первое вхождение,т.к. в след. итерации заново вычислить выбор
                }
              }
        }
/* 1. askUserInModalWindow -> async asyncAskUserInModalWindow возвращает промис, в котором
- отрисовка модальной фомы,
- определить функцию проверки выбора дела, которая вызывает себя в сеттаймауте100 если еще не выбрано  а если выбрано то делает resolve
- вызвать эту функцию (она в впромисе)
предназначена для вызова await

    //getArithm ->async asyncGetArithm с дублированием текста.
    возвращает промис в котором выполняется сеттаймаут 0 от всего этого кода

*/
    //выбор пользователем в модальном окне
    if(Gl_IsUserAnswered)
    for(var i0=0; i0<Gl_aGenRithm.length; i0++)  //повторение цикла N раз
        for(var i=Gl_aGenRithm.length-1; i>=0; i--){
            var sOld = Gl_aGenRithm[i].split("=")[0].trim();//разобрали в массив левую часть после =
            var sNew = Gl_aGenRithm[i].split("=")[1];//разобрали в массив правую часть после =
            var aProb = sNew.split("[ДЕЛ БЕЗ ПОВТОРЕНИЙ ИЗ]");//выбор вероятностных  дел.
            for(var j = i-1; j>=0; j--){
               if (aProb.length>1){
                  //ВЫБОР ОДНОГО ИЗ ДЕЛ ПОЛЬЗОВАТЕЛЕМ В МОДАЛЬНОМ ОКНЕ
                  //например <дело1>=[ВЫБОР ИЗ]<дело 11>:<дело 12>:<дело 13>[СПРОСИТЬ]"хотите выполнить дело 11?":"хотите выполнить дело 12?":"хотите выполнить дело 13?"
                  if (aProb[1].indexOf("[СПРОСИТЬ]")>0){
                      Gl_IsUserAnswered = false
                      document.getElementById("btnSelectAllTrain").disabled = true
                      var aTrains =  aProb[1].split("[СПРОСИТЬ]")[0].split(":");
                      var aQuestions =  aProb[1].split("[СПРОСИТЬ]")[1].split(":");
                      Gl_SelectedIndex=-1 //!
                      askUserInModalWindow(aQuestions,i,sOld,Gl_aGenRithm) //результат выбора будет в Gl_SelectedIndex
                      return //Ждем пока пользователь сделает выбор
                      //fWait=function(){
                      //  if (Gl_SelectedIndex<0) setTimeout(fWait,100)
                      //}
                      //fWait()
                      //! проблема - как подождать.. без промисов не решить??
                      //Gl_aGenRithm[j]=Gl_aGenRithm[j].replace(sOld,aTrains[Gl_SelectedIndex]);//заменим только первое вхождение
                      Gl_SelectedIndex=-1 //!
                  }
               }
            }
        }
    //!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    //alert('перед проговариванием \n'+Gl_aGenRithm[0])
    //!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

    //TODO делать дела с разботором онлайн - например в таких скобках _<...>_ Это позволит реализовать модальные окна выбора во время выполнения тренеировки
    //...
    //...

    //ИТОГО СТРОКА ТРЕНИРОВКИ - В Gl_aGenRithm[0]
    var  Gl_sTrain = Gl_aGenRithm[0].split("=")[1];  //??? сделать новую копию а не ссылку


    //== Разбор строки тренировки в массив ============
    Gl_flBegWord = false; //признак что первым элементом массива будет речь(дело) а не интервал
    if (!(Gl_sTrain.trim().indexOf("<#")==0))
      Gl_flBegWord = true;
    else Gl_sTrain = Gl_sTrain.replace("<#","<") //убрать первую решетку если начинается с интервала! чтобы после следующего split и удалений скобок не было пустого первого элемента

    //сделаем чтобы всегда начиналось с интервала
    if  (Gl_flBegWord){
       Gl_sTrain ="<0#>"+Gl_sTrain; //! без первой #
       Gl_flBegWord = false;
    }
    Gl_aRithmLisp = Gl_sTrain.split("#");
    

    finish_Gl_aRithmLisp()
    //ИТОГОВЫЙ ОДНОМЕРНЫЙ МАССИВ Gl_aRithmLisp
    //alert ('МАССИВ перед проговариванием \n'+Gl_aRithmLisp)
    //=========================================================
    document.getElementById("btnSelectAllTrain").disabled = false
    Gl_IsGenerated = true
    return Gl_aRithmLisp.slice();
    }

    function  finish_Gl_aRithmLisp(){
      for (var i1 = 0; i1 < Gl_aRithmLisp.length; i1++){
          //alert(Gl_aRithmLisp[i1])
          //убираем спецсимволы из речи
          try{
              var evMask = maskEvalOnlineBlocksForAngleStrip(Gl_aRithmLisp[i1]);
              var tStrip = evMask.t;
              tStrip = tStrip.split('><').join(' ');
              tStrip = tStrip.split('<').join(' ');
              tStrip = tStrip.split('>').join(' ');
              tStrip = tStrip.split('>').join(' ');
              Gl_aRithmLisp[i1] = unmaskEvalOnlineBlocksForAngleStrip(tStrip, evMask.parts);
          }catch(e){}
      }
      
    //обратная замена спецсимволов (в блоках eval)
    for(var j=1;j<Gl_aRithmLisp.length;j+=2)
      Gl_aRithmLisp[j] = Gl_aRithmLisp[j].replaceAll(GlSEqual,'=')
                                         .replaceAll(GlSMore,'>')
                                         .replaceAll(GlSLess,'<')
                                         .replaceAll(GlSSemicol,';')
                                         .replaceAll(GlSSquote,"'")
                                         .replaceAll(GlSDquote,'"')

      //ВТОРОЙ ПРОХОД - ВЫЧИСЛЕНИЕ "ОНЛАЙН-ПАРАМЕТРОВ" И ПЕРЕВОД ВРЕМЕНИ  В МСЕК
      _номер_итерации_=0
      _прошло_лет_=0
      _прошло_месяцев_=0
      _прошло_недель_=0
      _прошло_дней_=0
      _прошло_часов_=0
      _прошло_минут_=0
      _прошло_секунд_=0
      _прошло_милисекунд_=0
      _пульс_=-1
      _history_ = []
      //alert(Gl_aRithmLisp)
      for (var i = 0; i < Gl_aRithmLisp.length; i++){
        if (i%2==0){
          syncOnlinePulseParam()
          _номер_итерации_+=1;
          Gl_aRithmLisp[i]=calcEval("N",String(Gl_aRithmLisp[i]))
          Gl_aRithmLisp[i+1]=calcEval("S",String(Gl_aRithmLisp[i+1]))
          var nDelta = Math.round(Number(Gl_aRithmLisp[i]));
          var d=new Date();
          var aCurr = [d,Gl_aRithmLisp[i+1]];
          _history_.push(aCurr);
          _прошло_милисекунд_ +=nDelta
          _прошло_секунд_=Math.floor(_прошло_милисекунд_/1000)
          _прошло_минут_=Math.floor(_прошло_милисекунд_/(1000*60))
          _прошло_часов_=Math.floor(_прошло_милисекунд_/(1000*60*60))
          _прошло_дней_=Math.floor(_прошло_милисекунд_/(1000*60*60*24))
          _прошло_недель_=Math.floor(_прошло_милисекунд_/(1000*60*60*24*7))
          _прошло_часов_=Math.floor(_прошло_милисекунд_/(1000*60*60*24*365))
        }
      }

      //Добавим "тренировка завершена"
      var sDelim1 ="%%%%%%%%"
      if (Gl_aRithmLisp.length%2==1)
        Gl_aRithmLisp = (Gl_aRithmLisp.join(sDelim1)+sDelim1+TXT_BTN_FINISHED).split(sDelim1)
      else
         Gl_aRithmLisp = (Gl_aRithmLisp.join(sDelim1)+sDelim1+"1000"+sDelim1+TXT_BTN_FINISHED).split(sDelim1)

  }

  //выбор nCountToChange дел без повторений по строке sTrainAndPropportions вида "[ВЫБОР]4[ДЕЛ БЕЗ ПОВТОРЕНИЙ ИЗ]<дело1>:<дело2>:<дело3>:<дело4>:<дело5>[КАК]1:4:7:5:2"
  //после [КАК] - вероятности (пропорции) появления дела
  function fGetRandomSelected(/*from*/sTrainAndPropportions ){
                  if (sTrainAndPropportions.indexOf("[КАК]")>0){
                      var sRet = ""
                      var indSelected = -1
                      var nCountToSelect = Number( sTrainAndPropportions.split("[ДЕЛ БЕЗ ПОВТОРЕНИЙ ИЗ]")[0].split("[ВЫБОР]")[1])
                      //выбираем случ число от 0 до суммы пропорций, в какой отрезок оно попадет - то дело и выберем
                      var a2Prob=sTrainAndPropportions.split("[КАК]");
                      //   просто споит по : не проходит, если есть : в текстах внутри <>
                      var aSay =  a2Prob[0].split("[ДЕЛ БЕЗ ПОВТОРЕНИЙ ИЗ]")[1].split(GlSColon); //!! опасно, по идее надо подменять : в <> но как быть с формулами...
                      //for(var i=2;i<aSay.length;i++) aSay[i]=+'<'
                      //
                      var aProportions =  a2Prob[1].split(":");
                      var nSum = 0;
                      //привести пропорции к вероятностям
                      for(var jj=0; jj<aProportions.length; jj++) nSum+=Number(aProportions[jj]);
                      try{
                        for(var jj=0; jj<aProportions.length; jj++) aProportions[jj]=aProportions[jj]/nSum
                      } catch(e) {"ошибка при расчете выбора из: "+ sTrainAndPropportions +alert(e.toString())} //тут будет деление на 0 скорее всего
                      //цикл выбор дел
                      for (var ii=0; ii < nCountToSelect ;ii++){
                        var nRand = (Math.random()*(1));
                        var k =0;
                        var nSumCurr = 0;
                        while((nSumCurr<=nRand)&&(k<aProportions.length)){
                            nSumCurr+=Number(aProportions[k]);
                            k++;
                        }
                        indSelected = k-1
                        sRet+=aSay[ indSelected ] + " "//";"    // ((ii ==  nCountToSelect - 1 ))?"":";"
                        
                        //после выбора очередного дела выкинем его из списка выбора
                        //а вероятности оставшихся делим на (1-вероятность выкинутого), чтобы их сумма осталась =1
                        for(var jj=0; jj<aProportions.length; jj++) aProportions[jj] = aProportions[jj]/(1-  aProportions[  indSelected  ] )
                        aSay.splice(indSelected,1)
                        aProportions.splice(indSelected,1)
                      }   
                  }
            return sRet
  }

  fnModalOkClick = function(){
      document.getElementById("idMainWindow").style.display ="block"
      document.getElementById("idModalWindow").style.display ="none"
      Gl_IsUserAnswered = true
      //Gl_aGenRithm[j]=Gl_aGenRithm[j].replace(sOld,"aTrains[Gl_SelectedIndex]")

      //!Gl_aGenRithm = loc_aGenRithm
      Gl_aGenRithm[Gl_SelectedIndex] = Gl_sNameExToReplaceByUserAnswer+'='+'<Ответ получен>'
      Gl_IntervalId = setInterval(getArithm(Gl_aGenRithm),1500)
      //  getArithm(Gl_aGenRithm)
  }

  function askUserInModalWindow(aQueations, i, sOld,loc_aGenRithm){

    //скрываем основное окно, открываем модальное. Рисуем в нем радиокнопки выбора. И кнопку Ок, по которой закрываем модальное и возвращаем выбранную радиокнопку
    document.getElementById("idMainWindow").style.display ='none'
    document.getElementById("idModalWindow").style.display ='block'
    Gl_aGenRithm = loc_aGenRithm
    Gl_SelectedIndex = i
    Gl_sNameExToReplaceByUserAnswer = sOld
    document.getElementById("idModalButtonOk").setAttribute('onclick','fnModalOkClick()');

    //!!! TODO .........  !!!!!
  }



  function getTrainingNavPanel(){
    var nav = document.getElementById('idDivNavigation');
    if (!nav) return null;
    return nav.querySelector('.navigation-panel');
  }

  function clearTrainingNavUserBrowse(){
    Gl_navUserBrowsing = false;
    if (Gl_navBrowseTimer) {
      clearTimeout(Gl_navBrowseTimer);
      Gl_navBrowseTimer = null;
    }
  }

  function initTrainingNavScrollGuard(){
    if (Gl_navScrollGuardReady) return;
    var panel = getTrainingNavPanel();
    if (!panel) return;
    Gl_navScrollGuardReady = true;
    function onUserNavBrowse(){
      if (Gl_navProgrammaticScroll) return;
      Gl_navUserBrowsing = true;
      if (Gl_navBrowseTimer) clearTimeout(Gl_navBrowseTimer);
      Gl_navBrowseTimer = setTimeout(function(){
        Gl_navUserBrowsing = false;
        Gl_navBrowseTimer = null;
        scrollTrainingNavToProgress(true);
      }, 2000);
    }
    panel.addEventListener('scroll', onUserNavBrowse, { passive: true });
    panel.addEventListener('touchstart', onUserNavBrowse, { passive: true });
    panel.addEventListener('wheel', onUserNavBrowse, { passive: true });
    panel.addEventListener('mousedown', onUserNavBrowse);
  }

  function scrollTrainingNavToProgress(smooth){
    if (Gl_navUserBrowsing) return;
    var panel = getTrainingNavPanel();
    if (!panel || panel.offsetParent === null) return;
    var ind = GlnInd;
    var anchor = document.getElementById('buttonCurrentTr' + ind);
    if (ind > 1) {
      var prevBtn = document.getElementById('buttonCurrentTr' + (ind - 2));
      if (prevBtn) anchor = prevBtn;
    }
    if (!anchor) return;
    var panelRect = panel.getBoundingClientRect();
    var anchorRect = anchor.getBoundingClientRect();
    var target = Math.max(0, anchorRect.top - panelRect.top + panel.scrollTop - panel.clientHeight * 0.18);
    Gl_navProgrammaticScroll = true;
    if (smooth && typeof panel.scrollTo === 'function') {
      panel.scrollTo({ top: target, behavior: 'smooth' });
      setTimeout(function(){ Gl_navProgrammaticScroll = false; }, 500);
    } else {
      panel.scrollTop = target;
      Gl_navProgrammaticScroll = false;
    }
  }

  function paintTrainingNavProgress(activeIndex){
    for (var j = 0; j < activeIndex; j++) {
      try { document.getElementById('buttonCurrentTr' + j).style.background = 'green'; } catch (e) {}
    }
    for (var k = activeIndex; k < Gl_aRithmLisp.length; k++) {
      try { document.getElementById('buttonCurrentTr' + k).style.background = 'yellow'; } catch (e) {}
    }
  }

  function nextExercise(){
    var i= GlnInd
    while ((i<Gl_aRithmLisp.length-3)&&(Gl_aRithmLisp[i+2]==Gl_aRithmLisp[i]))  i+=2
    navigate(i)
  }
  function prevExercise(){
    var i= GlnInd
    if (i%2) i-=2
    else i--
    while ((i>3)&&(i<Gl_aRithmLisp.length-3)&&(Gl_aRithmLisp[i-2]==Gl_aRithmLisp[i])) i-=2
    navigate(i)
  }
  function next(){
    if (isTrainingExerciseNavMode()) nextExercise();
    else stepSavedTrainingHistory(-1);
  }
  function prev(){
    if (isTrainingExerciseNavMode()) prevExercise();
    else stepSavedTrainingHistory(1);
  }

  function navigate(i){ // для навигации по делам текущей трени
     if (Gl_decodeExternalCallValue.length=0)
         alert ("Будет произведен переход на дело '"+Gl_aRithmLisp[i]+"'")
     stopCurrentSpeech()
     clearTrainingNavUserBrowse();
     paintTrainingNavProgress(i);
     GlnDelta = 3000;// Number(Gl_aRithmLisp[i-1]);
     GlnInd =i;
     scrollTrainingNavToProgress(true);
     scheduleSaveTrainingSessionSnapshot();
  }


  function getText2Print(sTrainName){ //текст для печати
      //var aRithmLisp=[]
      var aSimult = []
      if (GltxtSpeek.value.indexOf(Gl_sSimultTrain)>=0){
        arrStr = GltxtSpeek.value.split(Gl_sSimultTrain)
        for (i=0;i<arrStr.length;i++) {
          aSimult.push([[],arrStr[i].split(Gl_sDelim)])
        }
        //aRithmLisp =
        stus(aSimult,'diff')
      }else //aRithmLisp=
            getArithm(GltxtSpeek.value.split(Gl_sDelim));

      //Gl_aRithmLisp=aRithmLisp.slice() //!!!!!!!!!!!

      Gl_txtPrint.value=sTrainName+"\n"
      Gl_txtPrint.value+='Тренировка продлится ' +calcTtrainTime(Gl_aRithmLisp)+' минут'+"\n\n"

      var str = ""
      var strNext = ""
      var strPrev = ""
      var nRepeat = 1
      for(var i=1;i<Gl_aRithmLisp.length;i+=2){
        str=Gl_aRithmLisp[i]+"   :"+Gl_aRithmLisp[i+1]+" ms  "+"\n"
        strNext=Gl_aRithmLisp[i+2]+"   :"+Gl_aRithmLisp[i+1+2]+" ms  "+"\n"
        if ((str!=strNext)){
           Gl_txtPrint.value += Gl_aRithmLisp[i]+"   :"+Gl_aRithmLisp[i+1]+" ms  "+ ((nRepeat==1)?"":"(повторить "+ nRepeat +" раз)") +"\n"
           nRepeat = 1
        }
        else nRepeat++
        strPrev = str
      }
    }

  function processSimultaneousMode(value,sMode){
       Gl_evalParamOverrides = null;
       var aSimultTrain =[]
      if (selectAllTrain.getAttribute("multiple")=="multiple"){
        GltxtSpeek.value =''
        Gl_currentTrainName = ''
        for (var i =0; i<selectAllTrain.options.length; i++)
          if (selectAllTrain.options[i].selected){
            Gl_currentTrainName += selectAllTrain.options[i].text + '  \n'+Gl_sSimultTrain+'\n   '  //!в наименовании тоже [ОДНОВРЕМЕННО С] - важно для текста печати
            aSimultTrain.push(Gl_aMetaRithm[getTrainIndexByName(selectAllTrain.options[i].text)][1][0])
            //aSimultTrain.push(Gl_aMetaRithm[i][1][0])
          }
      }else{
          Gl_currentTrainName = (Gl_aMetaRithm[value][1][0]).split('=')[0]
          /*
          в случае если треня есть одновременное выполнение других трень (первая строка - перречисление трень через [ОДНОВРЕМЕННО С])
          GltxtSpeek.value должен получиться  в виде "список трени 1 (а не имя трени!) [ОДНОВРЕМЕННО С] список трени 2 (а не имя трени!)..."
          Т.е. в цикле по Gl_aMetaRithm[value][1][0].split('[ОДНОВРЕМЕННО С]') (это имена трень) ищем текущую треню currIndex = найти индекс по имени..,
             берем ее список Gl_aMetaRithm[currIndex][1] и добавляем к GltxtSpeek.value,
             если есть трени за ней (смотрим по длине массива цикла) - добавляем еще "[ОДНОВРЕМЕННО С]"
          */
          GltxtSpeek.value=''
          aSimultTrain = Gl_aMetaRithm[value][1][0].split(Gl_sSimultTrain);
      }

      for(var i=0;i<aSimultTrain.length;i++){
          if ((i==0)&&(aSimultTrain.length>1))
            try{
 //ok getTrainIndexByName
              GltxtSpeek.value+=Gl_aMetaRithm[getTrainIndexByName(aSimultTrain[i].split('=')[1])][1].join('     '+Gl_sDelim+'\n')
            } catch(e){ //падает в режиме множественного выбора
              GltxtSpeek.value+=Gl_aMetaRithm[getTrainIndexByName(aSimultTrain[i].split('=')[0])][1].join('     '+Gl_sDelim+'\n')
            }
          else
            GltxtSpeek.value+=Gl_aMetaRithm[getTrainIndexByName(aSimultTrain[i].split('=')[0])][1].join('     '+Gl_sDelim+'\n')
          if((i<aSimultTrain.length-1)&&(aSimultTrain.length>1)) GltxtSpeek.value+='\n'+Gl_sSimultTrain+'\n'
      }

  }

  function execTrain1ProceedAfterArithm(sMode){
    var aRithmLisp=[]
    var aSimult = []
    if (GltxtSpeek.value.indexOf(Gl_sSimultTrain)>=0){
        var arrStr = GltxtSpeek.value.split(Gl_sSimultTrain)
        for (i=0;i<arrStr.length;i++) {
          aSimult.push([[],arrStr[i].split(Gl_sDelim)])
        }
        Gl_aRithmLisp = stus(aSimult,'diff')
    }else aRithmLisp=getArithm(GltxtSpeek.value.split(Gl_sDelim));

    if (!Gl_IsGenerated) return

    buildTrainingNavigationList();

    if (sMode!="Run") return

    Gl_State = TXT_BTN_STARTED
    syncTrainPageSetupLinksVisibility()
    if (1==1)
    {
      if (Gl_resumeFromHistoryOnRun && Gl_historyPreviewSnap) {
        var hs = Gl_historyPreviewSnap;
        GlnInd = hs.stoppedAtIndex != null ? hs.stoppedAtIndex : (hs.GlnInd || 1);
        try {
          if (GlnInd > 0) GlnDelta = calcMilliseconds(String(Gl_aRithmLisp[GlnInd - 1]));
          else GlnDelta = Number(Gl_aRithmLisp[0]) || 0;
        } catch (e) { GlnDelta = 3000; }
        GlflSayIntro = true;
        GlflSayIntro2 = true;
        Gl_resumeFromHistoryOnRun = false;
        Gl_historyPreviewSnap = null;
      } else {
        GlnDelta=0;
        GlnInd=0;
        if (!Gl_flBegWord){
             GlnDelta = Number(Gl_aRithmLisp[0]);
             GlnInd =1;
        }
      }
      paintTrainingNavProgress(GlnInd);
        {
            if (!Gl_SayInterval)
              Gl_SayInterval = setInterval(fSayInTime,10);
            scheduleSaveTrainingSessionSnapshot();
        }
    }
  }

  //Запускает цикл проговаривания тренировки
  function execTrain1(value, sMode){
    //скрываем календарь
    //?! document.getElementById("idDivActionCalendar").style.display ='none'
    //? document.getElementById("btnRecalcCal").innerHTML = 'Показать календарь'

    if (sMode=="Run"){
      if (GlIsRunning){
        pauseTrainingPlayback()
        return
      }
      if (Gl_State==TXT_BTN_PAUSED){
        resumeTrainingPlayback()
        return
      }
      maybeShowEvalParametersBeforeRun(
        function () {
          beginTrainingRunSession();
          execTrain1ProceedAfterArithm(sMode);
        },
        abortTrainingRunAfterEvalCancel
      );
      return;
    }

    if (sMode=="Calendar")  {
      Gl_currentTrainName = Gl_aMultiCalendar[value].trim()
//???@ OK if calendars are not filtered now (value - from calendars)
      var nIndexInMetaRithm = getTrainIndexByName("<"+Gl_aMultiCalendar[value].trim()+">")
      var aEv = Gl_aMetaRithm[nIndexInMetaRithm][1]
      GltxtSpeek.value= aEv.join('     '+Gl_sDelim+'\n')
      selectAllTrain.selectedIndex = getTrainIndexByName("<"+Gl_aMultiCalendar[value].trim()+">") //!!!!
      document.getElementById("trainPage").style.display ='block'
      document.getElementById("checkTrainPage").checked = true
      document.getElementById("calendarPage").style.display ='none'
      document.getElementById("checkCalendarPage").checked = false
      document.getElementById("selectedCalendars").style.display ='none'
      document.getElementById("checkPage").style.display ='none'
      alert('Тренировка загружена. Вы можете изменить код тренировки. Для запуска еще раз нажмите кнопку "Начать тренировку." ')
      processSimultaneousMode(nIndexInMetaRithm,sMode)
      btnSelectAllTrain.setAttribute('onclick','execTrain1(0,"Run")');
      getText2Print(Gl_currentTrainName)
      return
    } else if (sMode=="Act")  {
      processSimultaneousMode(value,sMode)

      //alert('Тренировка загружена. Вы можете изменить код тренировки. Для запуска еще раз нажмите кнопку "Начать тренировку." ')
      btnSelectAllTrain.setAttribute('onclick','execTrain1(0,"Run")');

      getText2Print(Gl_currentTrainName)
      if (isTrainEditorPanelOpen())
        loadTrainEditorForIndex(typeof value === "number" ? value : getCurrentTrainingMetaIndex());
      return
    }

    execTrain1ProceedAfterArithm(sMode);
  }

    //Печать тренировки
    function updatePrintTextButtonVisibility(){
      var printText = document.getElementById("idTextPrint")
      var printButton = document.getElementById("btnPrintTextToPrinter")
      if (!printText || !printButton)
        return

      printButton.style.display = printText.value.trim().length ? 'inline-flex' : 'none'
    }

    function escapeHtmlForPrint(text){
      return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
    }

    function printTrainingText(){
      var text = document.getElementById("idTextPrint").value
      if (!text.trim()){
        updatePrintTextButtonVisibility()
        return
      }

      if (callAndroidTraining("printText", text, "Текст тренировки для печати"))
        return

      var printWindow = window.open('', '_blank')
      if (!printWindow){
        window.print()
        return
      }

      printWindow.document.open()
      printWindow.document.write(
        '<!doctype html><html><head><meta charset="utf-8"><title>Текст тренировки для печати</title>' +
        '<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;}pre{white-space:pre-wrap;font-size:16px;line-height:1.45;}</style>' +
        '</head><body><pre>' + escapeHtmlForPrint(text) + '</pre></body></html>'
      )
      printWindow.document.close()
      printWindow.focus()
      printWindow.print()
    }

    function CallPrint() {
      document.getElementById("idTextPrint").value=Gl_txtPrint.value
      document.getElementById("idTextPrint").style.height =(200+document.getElementById("idTextPrint").scrollHeight)+"px"
      updatePrintTextButtonVisibility()
   }

   function btnPrintOnClick(){
     getText2Print(Gl_currentTrainName)
     document.getElementById("idTextPrintDetails").open='open';
     CallPrint()
   }

/* ===================== конец БЛОКА 2 — app.js ===================== */
