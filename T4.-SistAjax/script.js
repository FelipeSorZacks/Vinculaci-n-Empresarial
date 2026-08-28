/* =========================================================
   Prototipo de Control de Asistencia por QR
   Solo HTML/CSS/JS + localStorage. Pensado para sustituirse
   después por un backend real (API, base de datos, auth).
   ========================================================= */

const DB_KEY = "qr_attendance_db_v1";

function defaultDB(){
  return { domain: "instituto.edu.mx", events: [], attendances: [] };
}
function loadDB(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : defaultDB();
  }catch(e){ return defaultDB(); }
}
function saveDB(db){ localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function uid(prefix){ return prefix + "-" + Math.random().toString(36).slice(2,8); }

let db = loadDB();
let participantSession = null;   // {nombre, correo}
let adminSession = null;         // {correo}
let selectedEventId = null;
let html5QrCode = null;

/* =========================================================
   AJAX: carga la configuración institucional inicial
   =========================================================
   La primera vez que se abre el prototipo (aún no hay nada en
   localStorage) se pide el dominio institucional al "servidor"
   con una petición AJAX (XMLHttpRequest) a config.json, en vez
   de dejarlo fijo en el código. Así el archivo JS no cambia si
   la escuela usa otro dominio: solo se edita config.json.

   Sigue el mismo patrón que el ejemplo del profesor:
   GET asíncrono + xhr.onreadystatechange + manejo de errores.
   ========================================================= */
function cargarConfiguracionInicial(callback){
  // Si ya hay datos guardados de una sesión anterior, respetamos
  // el dominio que ya se configuró y no volvemos a pedirlo.
  if (localStorage.getItem(DB_KEY)){
    callback();
    return;
  }

  const xhr = new XMLHttpRequest();

  // GET a config.json, en la misma carpeta que index.html.
  // "true" = petición asíncrona (AJAX): la página sigue respondiendo
  // mientras se espera la respuesta del servidor.
  xhr.open("GET", "config.json", true);

  xhr.onreadystatechange = function(){
    // readyState 4 (DONE) = la petición ya terminó.
    if (xhr.readyState !== XMLHttpRequest.DONE) return;

    if (xhr.status >= 200 && xhr.status < 300){
      try{
        const config = JSON.parse(xhr.responseText);
        if (config.domain){
          db.domain = config.domain;
          saveDB(db);
        }
      }catch(e){
        console.warn("config.json no tiene un formato JSON válido; se usa el dominio por defecto.");
      }
    } else {
      console.warn("No se pudo cargar config.json (HTTP " + xhr.status + "); se usa el dominio por defecto.");
    }
    callback();
  };

  // Se dispara si la petición falla a nivel de red (por ejemplo,
  // al abrir el archivo directamente con doble clic en vez de usar
  // un servidor local).
  xhr.onerror = function(){
    console.warn("Error de red al cargar config.json; se usa el dominio por defecto.");
    callback();
  };

  xhr.send();
}

/* ---------------- Toast ---------------- */
function toast(msg, isError){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.toggle("error", !!isError);
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> t.classList.remove("show"), 2600);
}

/* ---------------- Vista Participante / Administrador ---------------- */
document.querySelectorAll(".role-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".role-btn").forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-selected","false"); });
    btn.classList.add("active"); btn.setAttribute("aria-selected","true");
    const role = btn.dataset.role;
    document.getElementById("view-participante").classList.toggle("active", role === "participante");
    document.getElementById("view-administrador").classList.toggle("active", role === "administrador");
    if (role === "administrador") renderAdmin();
  });
});

/* =========================================================
   PARTICIPANTE
   ========================================================= */
function pGoToStep(step){
  document.querySelectorAll("#p-steps .step-dot").forEach(d=>{
    d.classList.remove("active","complete");
    const order = ["login","scan","done"];
    if (order.indexOf(d.dataset.step) < order.indexOf(step)) d.classList.add("complete");
    if (d.dataset.step === step) d.classList.add("active");
  });
  document.querySelectorAll(".participant-shell .panel").forEach(p=>{
    p.classList.toggle("hidden", p.dataset.panel !== step);
  });
}

document.getElementById("p-login-btn").addEventListener("click", ()=>{
  const nombre = document.getElementById("p-nombre").value.trim();
  const correo = document.getElementById("p-correo").value.trim().toLowerCase();
  const errEl = document.getElementById("p-login-error");
  errEl.textContent = "";

  if (!nombre || !correo){
    errEl.textContent = "Escribe tu nombre y tu correo institucional.";
    return;
  }
  const domain = db.domain.toLowerCase();
  if (!correo.endsWith("@" + domain)){
    errEl.textContent = `Ese correo no pertenece al dominio institucional (@${db.domain}).`;
    return;
  }

  participantSession = { nombre, correo };
  document.getElementById("p-hello-name").textContent = nombre;
  document.getElementById("p-hello-email").textContent = correo;
  fillManualEventSelect();
  pGoToStep("scan");
});

document.getElementById("p-logout-btn").addEventListener("click", ()=>{
  stopCamera();
  participantSession = null;
  document.getElementById("p-nombre").value = "";
  document.getElementById("p-correo").value = "";
  document.getElementById("p-login-error").textContent = "";
  pGoToStep("login");
});

document.getElementById("p-again-btn").addEventListener("click", ()=>{
  document.getElementById("p-scan-error").textContent = "";
  fillManualEventSelect();
  pGoToStep("scan");
});

/* --- pestañas cámara / modo de prueba --- */
document.querySelectorAll(".scan-tab").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    document.querySelectorAll(".scan-tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    document.querySelectorAll(".scan-pane").forEach(p=>{
      p.classList.toggle("hidden", p.dataset.pane !== mode);
    });
    if (mode !== "camera") stopCamera();
  });
});

function fillManualEventSelect(){
  const sel = document.getElementById("p-manual-event");
  const activos = db.events.filter(e => e.activo);
  sel.innerHTML = activos.length
    ? activos.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join("")
    : `<option value="">No hay eventos activos</option>`;
}

document.getElementById("p-manual-scan-btn").addEventListener("click", ()=>{
  const sel = document.getElementById("p-manual-event");
  if (!sel.value){ document.getElementById("p-scan-error").textContent = "No hay ningún evento activo para simular."; return; }
  handleScan(sel.value);
});

document.getElementById("p-start-camera").addEventListener("click", startCamera);

function startCamera(){
  const btn = document.getElementById("p-start-camera");
  const errEl = document.getElementById("p-scan-error");
  errEl.textContent = "";
  if (typeof Html5Qrcode === "undefined"){
    errEl.textContent = "No se pudo cargar el lector de cámara. Usa el modo de prueba.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Iniciando cámara…";
  html5QrCode = new Html5Qrcode("qr-reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 200 },
    (decodedText)=>{ stopCamera(); handleScan(decodedText); },
    ()=>{ /* frame sin QR, ignorar */ }
  ).then(()=>{
    btn.textContent = "Cámara activa";
  }).catch(()=>{
    errEl.textContent = "No se pudo acceder a la cámara (permiso denegado o sin HTTPS). Usa el modo de prueba.";
    btn.disabled = false;
    btn.textContent = "Activar cámara";
  });
}
function stopCamera(){
  if (html5QrCode){
    html5QrCode.stop().catch(()=>{});
    html5QrCode = null;
  }
  const btn = document.getElementById("p-start-camera");
  if (btn){ btn.disabled = false; btn.textContent = "Activar cámara"; }
}

function handleScan(rawValue){
  let eventId = rawValue;
  try{ const parsed = JSON.parse(rawValue); if (parsed && parsed.eventId) eventId = parsed.eventId; }catch(e){ /* valor plano */ }

  const evento = db.events.find(e => e.id === eventId);
  const errEl = document.getElementById("p-scan-error");

  if (!evento || !evento.activo){
    errEl.textContent = "QR inválido o el evento ya está cerrado. Vuelve a intentarlo.";
    toast("QR inválido o evento cerrado", true);
    return;
  }

  const yaRegistrado = db.attendances.find(a => a.eventId === evento.id && a.correo === participantSession.correo);
  if (yaRegistrado){
    showConfirm("warn", "Ya estabas registrado", evento.nombre, yaRegistrado.hora, "Tu asistencia a este evento ya se había registrado antes.");
    return;
  }

  const registro = {
    eventId: evento.id,
    nombre: participantSession.nombre,
    correo: participantSession.correo,
    hora: new Date().toLocaleString("es-MX", { dateStyle:"short", timeStyle:"short" })
  };
  db.attendances.push(registro);
  saveDB(db);
  showConfirm("ok", "Asistencia registrada", evento.nombre, registro.hora, "Tu registro quedó guardado correctamente.");
  toast("Asistencia registrada");
  if (adminSession) renderEventDetail(); // refleja en vivo si el admin está viendo
}

function showConfirm(kind, title, eventName, hora, note){
  const badge = document.getElementById("p-confirm-badge");
  badge.classList.remove("error","warn");
  if (kind === "warn") badge.classList.add("warn");
  document.getElementById("p-confirm-title").textContent = title;
  document.getElementById("p-confirm-event").textContent = eventName;
  document.getElementById("p-confirm-time").textContent = hora;
  document.getElementById("p-confirm-note").textContent = note || "";
  pGoToStep("done");
}

/* =========================================================
   ADMINISTRADOR
   ========================================================= */
document.getElementById("a-login-btn").addEventListener("click", ()=>{
  const correo = document.getElementById("a-correo").value.trim().toLowerCase();
  const errEl = document.getElementById("a-login-error");
  errEl.textContent = "";
  const domain = db.domain.toLowerCase();

  if (!correo){ errEl.textContent = "Escribe tu correo institucional."; return; }
  if (!correo.endsWith("@" + domain)){
    errEl.textContent = `Ese correo no pertenece al dominio institucional (@${db.domain}).`;
    return;
  }
  const localPart = correo.split("@")[0];
  if (!localPart.includes("admin")){
    errEl.textContent = "Esta cuenta no tiene permisos de administrador (usa un correo que incluya 'admin', ej. admin@" + db.domain + ").";
    return;
  }
  adminSession = { correo };
  toast("Sesión de administrador iniciada");
  renderAdmin();
});

document.getElementById("a-domain-save").addEventListener("click", ()=>{
  const val = document.getElementById("a-domain").value.trim().toLowerCase();
  if (!val) return;
  db.domain = val;
  saveDB(db);
  document.getElementById("p-domain-hint").textContent = "@" + db.domain;
  toast("Dominio institucional actualizado");
});

document.getElementById("a-reset-btn").addEventListener("click", ()=>{
  if (!confirm("Esto borrará todos los eventos y asistencias de prueba. ¿Continuar?")) return;
  localStorage.removeItem(DB_KEY);
  location.reload();
});

/* --- navegación de pestañas del admin --- */
document.querySelectorAll(".admin-nav-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".admin-nav-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".admin-tab").forEach(t=>{
      t.classList.toggle("active", t.dataset.tab === btn.dataset.tab);
    });
    if (btn.dataset.tab === "eventos") renderEventsList();
  });
});

/* --- crear evento --- */
document.getElementById("a-event-form").addEventListener("submit", (e)=>{
  e.preventDefault();
  if (!adminSession){ toast("Inicia sesión como administrador primero.", true); return; }

  const nombre = document.getElementById("ev-nombre").value.trim();
  const fecha = document.getElementById("ev-fecha").value;
  const lugar = document.getElementById("ev-lugar").value.trim();
  if (!nombre || !fecha) return;

  const evento = {
    id: uid("EVT"),
    nombre, fecha, lugar,
    activo: true,
    creadoEn: new Date().toISOString(),
    organizador: adminSession.correo
  };
  db.events.push(evento);
  saveDB(db);
  e.target.reset();
  toast("Evento creado: " + nombre);

  selectedEventId = evento.id;
  document.querySelector('.admin-nav-btn[data-tab="eventos"]').click();
});

/* --- lista y detalle de eventos --- */
function renderAdmin(){
  document.getElementById("a-session-banner").classList.toggle("hidden", !!adminSession);
  renderEventsList();
}

function renderEventsList(){
  const list = document.getElementById("a-events-list");
  if (!db.events.length){
    list.innerHTML = `<li class="empty-state">Aún no hay eventos creados.</li>`;
    document.getElementById("a-event-detail").innerHTML = `<p class="empty-state">Selecciona un evento de la lista.</p>`;
    return;
  }
  list.innerHTML = db.events.slice().reverse().map(ev=>{
    const count = db.attendances.filter(a=>a.eventId===ev.id).length;
    return `
      <li class="event-item ${ev.id===selectedEventId ? "selected":""}" data-id="${ev.id}">
        <strong>${escapeHtml(ev.nombre)}</strong>
        <div class="ev-meta">${ev.fecha}${ev.lugar ? " · "+escapeHtml(ev.lugar) : ""} · ${count} asistente${count===1?"":"s"}</div>
        <span class="badge ${ev.activo?"on":"off"}">${ev.activo?"ACTIVO":"CERRADO"}</span>
      </li>`;
  }).join("");

  list.querySelectorAll(".event-item").forEach(li=>{
    li.addEventListener("click", ()=>{
      selectedEventId = li.dataset.id;
      renderEventsList();
      renderEventDetail();
    });
  });

  if (selectedEventId && db.events.some(e=>e.id===selectedEventId)) renderEventDetail();
}

function renderEventDetail(){
  const box = document.getElementById("a-event-detail");
  const ev = db.events.find(e=>e.id===selectedEventId);
  if (!ev){ box.innerHTML = `<p class="empty-state">Selecciona un evento de la lista.</p>`; return; }

  const asistentes = db.attendances.filter(a=>a.eventId===ev.id);

  box.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(ev.nombre)}</h2>
        <div class="ev-meta">${ev.fecha}${ev.lugar ? " · "+escapeHtml(ev.lugar) : ""}</div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-secondary btn-small" id="btn-toggle-event">${ev.activo ? "Cerrar evento" : "Reabrir evento"}</button>
        <button class="btn btn-secondary btn-small" id="btn-export-csv">Exportar CSV</button>
      </div>
    </div>
    <div class="detail-grid">
      <div class="qr-card">
        <div id="qr-canvas"></div>
        <span>${ev.id}</span>
      </div>
      <div>
        <p class="attendee-count">${asistentes.length} asistente${asistentes.length===1?"":"s"} registrado${asistentes.length===1?"":"s"}</p>
        ${asistentes.length ? `
        <table class="attendee-table">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Hora</th></tr></thead>
          <tbody>
            ${asistentes.map(a=>`<tr><td>${escapeHtml(a.nombre)}</td><td>${escapeHtml(a.correo)}</td><td>${a.hora}</td></tr>`).join("")}
          </tbody>
        </table>` : `<p class="empty-state">Todavía no hay asistentes registrados para este evento.</p>`}
      </div>
    </div>
  `;

  const qrBox = document.getElementById("qr-canvas");
  qrBox.innerHTML = "";
  if (typeof QRCode !== "undefined"){
    new QRCode(qrBox, { text: JSON.stringify({ eventId: ev.id }), width: 140, height: 140, colorDark:"#0E1524", colorLight:"#ffffff" });
  } else {
    qrBox.textContent = "QR no disponible";
  }

  document.getElementById("btn-toggle-event").addEventListener("click", ()=>{
    ev.activo = !ev.activo;
    saveDB(db);
    toast(ev.activo ? "Evento reabierto" : "Evento cerrado");
    renderEventsList();
    renderEventDetail();
  });

  document.getElementById("btn-export-csv").addEventListener("click", ()=> exportCSV(ev, asistentes));
}

function exportCSV(ev, asistentes){
  const rows = [["Nombre","Correo","Hora","Evento"], ...asistentes.map(a=>[a.nombre, a.correo, a.hora, ev.nombre])];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `asistencia_${ev.nombre.replace(/\s+/g,"_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

/* ---------------- Inicio ---------------- */
// Primero se resuelve la configuración inicial vía AJAX y, hasta
// tenerla lista, se pintan los elementos que dependen de ella.
cargarConfiguracionInicial(function(){
  document.getElementById("p-domain-hint").textContent = "@" + db.domain;
  document.getElementById("a-domain").value = db.domain;
  renderEventsList();
});
