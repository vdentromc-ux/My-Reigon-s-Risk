// My Region's Risk — script.js
// APIs: Nominatim (geocoding), USGS (earthquakes), NASA EONET (fires/floods/etc), NWS (alerts)

// Live family sync uses Y.js + WebRTC — no account or setup needed.

function pctColor(pct) {
  const hue = Math.round(pct * 1.2); // 0 → red (hsl 0), 100 → yellow-green (hsl 120)
  return `hsl(${hue}, 78%, 50%)`;
}

function setBar(el, pct) {
  if (!el) return;
  el.style.width = pct + '%';
  el.style.backgroundColor = pctColor(pct);
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const THEMES = {
  dark:     { label: 'Dark',     dot: '#f97316' },
  light:    { label: 'Light',    dot: '#f97316' },
  ocean:    { label: 'Ocean',    dot: '#38bdf8' },
  forest:   { label: 'Forest',   dot: '#22c55e' },
  midnight: { label: 'Midnight', dot: '#a78bfa' },
  crimson:  { label: 'Crimson',  dot: '#fb7185' },
};

function setTheme(name) {
  Object.keys(THEMES).forEach(t => document.documentElement.classList.remove('theme-' + t));
  if (name !== 'dark') document.documentElement.classList.add('theme-' + name);
  localStorage.setItem('mrr_theme', name);
  const info = THEMES[name] || THEMES.dark;
  const dot = document.getElementById('themePickDot');
  const lbl = document.getElementById('themePickLabel');
  if (dot) dot.style.background = info.dot;
  if (lbl) lbl.textContent = info.label;
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === name);
  });
  document.getElementById('themeDrop')?.classList.add('hidden');
}

function toggleThemePicker() {
  document.getElementById('themeDrop').classList.toggle('hidden');
  document.getElementById('langMenu')?.classList.add('hidden');
}

(function () {
  const saved = localStorage.getItem('mrr_theme') || 'dark';
  document.addEventListener('DOMContentLoaded', () => setTheme(saved));
})();

const RADIUS_KM = 400;
const YEARS_BACK = 5;   // fetch window — never changes
const R_EARTH = 6371;

// ── State ────────────────────────────────────────────────────────────────────
let map = null;
let markerLayer = null;
let allEvents = [];
let sliderYears = [];
let playInterval = null;
let currentLocation = null;
let currentRisks = [];
let families = JSON.parse(localStorage.getItem('mrr_families') || '[]');

// Keep families in sync across tabs of the same browser
window.addEventListener('storage', e => {
  if (e.key !== 'mrr_families') return;
  families = JSON.parse(e.newValue || '[]');
  renderTracker();
  families.filter(f => f.isLive && f.code && !ydocs[f.code])
    .forEach(f => ensureYjs().then(() => startYjsSync(f)).catch(() => {}));
});
let analysisYears = 5;
let cachedYears = 5;
let analysisLabel = '5-yr';
let storedEarthquakes = [], storedNaturalEvents = [], storedAlerts = [];

// ── Internationalisation ───────────────────────────────────────────────────────
let currentLang = localStorage.getItem('mrr_lang') || 'en';

const TRANSLATIONS = {
  en: {
    lang_name:'EN', header_subtitle:'Real-time disaster awareness & preparedness checklist',
    search_label:'Search your region', search_placeholder:'City, state, or zip code…',
    search_btn:'Search', geo_btn:'📍 Use My Location',
    empty_title:'Search your region to get started',
    empty_msg:'Enter a city or use your location to see recent disaster events,<br>a risk analysis, and a personalized preparedness checklist.',
    loading_title:'Fetching regional data…',
    loading_msg:'Querying USGS earthquakes, NASA EONET natural events,<br>and NWS active weather alerts',
    map_title:'🗺️ Event Map', time_machine:'⏱ Time Machine', all_time:'All Time',
    play:'▶ Play', pause:'⏸ Pause',
    stat_quakes:'Quakes', stat_fires:'Wildfires', stat_floods:'Floods', stat_alerts:'Alerts',
    risks_title:'⚠️ Top Regional Risks',
    day_btn:'Day', week_btn:'Week', month_btn:'Month', yr_unit:'yr',
    tracker_title:'👨‍👩‍👧 Household Tracker',
    family_placeholder:'New family name…', add_family_btn:'+ Family',
    join_placeholder:'Enter code to join a family…', join_btn:'Join',
    disasters_nav_btn:'🌋 Natural Disasters',
    weather_nav_btn:'⛅ Weather', checklist_nav_btn:'✅ Preparedness Checklist',
    back_menu:'← Back to Menu', back_results:'← Results',
    checklist_title:'✅ Preparedness Checklist',
    checklist_subtitle:'Tailored to your regional risks · check items off as you build your kit',
    overall_prep:'Overall Preparedness',
    weather_title:'⛅ Current Weather', wind_speed:'Wind Speed', precipitation:'Precipitation', feels_like:'Feels like',
    share_btn:'🔗 Share', save_report_btn:'💾 Save Report',
    no_events:'No significant events detected in this region for the selected window.',
    weighted_event:'weighted event', weighted_events:'weighted events',
    conf_high:'High confidence', conf_med:'Medium confidence', conf_low:'Low confidence',
    universal_name:'Universal Essentials', universal_reason:'Applies to every emergency type', reset_btn:'↺ Reset',
    risk_earthquake:'Earthquake', risk_wildfire:'Wildfire', risk_flood:'Flood', risk_volcano:'Volcano',
    risk_storm:'Severe Storm', risk_drought:'Drought', risk_tornado:'Tornado', risk_hurricane:'Hurricane',
    risk_winter_storm:'Winter Storm', risk_extreme_heat:'Extreme Heat', risk_severe_weather:'Severe Weather',
    wmo_0:'Clear Sky', wmo_1:'Mostly Clear', wmo_2:'Partly Cloudy', wmo_3:'Overcast',
    wmo_fog:'Foggy', wmo_drizzle:'Drizzle', wmo_rain:'Rain', wmo_snow:'Snow',
    wmo_rain_showers:'Rain Showers', wmo_snow_showers:'Snow Showers', wmo_thunderstorm:'Thunderstorm',
    ck_earthquake_reason:'Based on seismic activity detected in your area',
    ck_wildfire_reason:'Wildfire events detected in your region',
    ck_flood_reason:'Flood events detected near your region',
    ck_volcano_reason:'Volcanic activity detected near your region',
    ck_winter_storm_reason:'Winter storm risk or alerts detected',
    ck_hurricane_reason:'Hurricane risk or alerts detected',
    ck_tornado_reason:'Tornado risk or alerts detected',
    ck_extreme_heat_reason:'Extreme heat alerts active in region',
    ck_storm_reason:'Storm events detected in region',
    ck_drought_reason:'Drought conditions detected in region',
    ck_severe_weather_reason:'General severe weather risk for this region',
    lp_slogan:'Your region. Your risks. Your plan.',
    lp_sub:'Real-time disaster data, personalized risk analysis, and preparedness tools — built around your exact location, for free.',
    lp_cta_start:'Get Started →',
    lp_no_bs:'No account required · Free forever',
    lp_source_label:'Live data from',
    lp_section_tag:'Why choose this',
    lp_section_title:'Not another generic emergency app',
    lp_section_sub:"Most apps show national headlines. We analyze what's happening within 400 km of your exact address.",
    lp_panel1_title:'Live Disaster Data',
    lp_panel1_desc:'Pulls earthquake data from USGS, natural events from NASA EONET, and active weather alerts from NWS in real time — every time you search.',
    lp_panel2_title:'Hyper-Local Risk Analysis',
    lp_panel2_desc:'Events in a 400 km radius around your exact coordinates are ranked by frequency and weighted severity — not national averages.',
    lp_panel3_title:'Personalized Checklists',
    lp_panel3_desc:"Your preparedness checklist is built from your regional risk profile. Earthquake zone? You get earthquake items. Wildfire area? Same idea.",
    lp_panel4_title:'Disaster Education',
    lp_panel4_desc:'Detailed guides for 12 types of natural disasters — causes, warning signs, what to do during, and what to do after — backed by official sources.',
    lp_panel5_title:'Weather & Active Alerts',
    lp_panel5_desc:'Current conditions and live NWS emergency alerts for your area, plus an interactive map to visualize historical disaster events over time.',
    lp_panel6_title:'Household Tracker',
    lp_panel6_desc:"Create family groups, track each member's preparedness progress, and sync in real time across devices — no sign-up required.",
    lp_bottom_title:"Ready to see what's happening in your region?",
    lp_bottom_sub:'Just enter your city. Takes under 10 seconds.',
    lp_bottom_cta:'Check My Region →',
    scroll_hint:'Scroll for more',
    home_btn:'🏠 Home',
  },
  es: {
    lang_name:'ES', header_subtitle:'Concienciación sobre desastres y lista de preparación en tiempo real',
    search_label:'Busca tu región', search_placeholder:'Ciudad, estado o código postal…',
    search_btn:'Buscar', geo_btn:'📍 Usar mi ubicación',
    empty_title:'Busca tu región para comenzar',
    empty_msg:'Ingresa una ciudad o usa tu ubicación para ver eventos recientes,<br>un análisis de riesgos y una lista de preparación personalizada.',
    loading_title:'Obteniendo datos regionales…',
    loading_msg:'Consultando sismos USGS, eventos naturales NASA EONET<br>y alertas meteorológicas NWS',
    map_title:'🗺️ Mapa de Eventos', time_machine:'⏱ Máquina del Tiempo', all_time:'Todo el tiempo',
    play:'▶ Reproducir', pause:'⏸ Pausar',
    stat_quakes:'Sismos', stat_fires:'Incendios', stat_floods:'Inundaciones', stat_alerts:'Alertas',
    risks_title:'⚠️ Principales Riesgos Regionales',
    day_btn:'Día', week_btn:'Semana', month_btn:'Mes', yr_unit:'año',
    tracker_title:'👨‍👩‍👧 Rastreador del Hogar',
    family_placeholder:'Nombre de familia nuevo…', add_family_btn:'+ Familia',
    join_placeholder:'Ingresa un código para unirte…', join_btn:'Unirse',
    disasters_nav_btn:'🌋 Desastres Naturales',
    weather_nav_btn:'⛅ Clima', checklist_nav_btn:'✅ Lista de Preparación',
    back_menu:'← Volver al Menú', back_results:'← Resultados',
    checklist_title:'✅ Lista de Preparación',
    checklist_subtitle:'Adaptada a tus riesgos regionales · marca los elementos mientras preparas tu kit',
    overall_prep:'Preparación General',
    weather_title:'⛅ Clima Actual', wind_speed:'Velocidad del Viento', precipitation:'Precipitación', feels_like:'Sensación térmica',
    share_btn:'🔗 Compartir', save_report_btn:'💾 Guardar Informe',
    no_events:'No se detectaron eventos significativos en esta región para el período seleccionado.',
    weighted_event:'evento ponderado', weighted_events:'eventos ponderados',
    conf_high:'Alta confianza', conf_med:'Confianza media', conf_low:'Baja confianza',
    universal_name:'Elementos Universales', universal_reason:'Aplica a todo tipo de emergencia', reset_btn:'↺ Restablecer',
    risk_earthquake:'Terremoto', risk_wildfire:'Incendio Forestal', risk_flood:'Inundación', risk_volcano:'Volcán',
    risk_storm:'Tormenta Severa', risk_drought:'Sequía', risk_tornado:'Tornado', risk_hurricane:'Huracán',
    risk_winter_storm:'Tormenta de Invierno', risk_extreme_heat:'Calor Extremo', risk_severe_weather:'Clima Severo',
    wmo_0:'Cielo Despejado', wmo_1:'Mayormente Despejado', wmo_2:'Parcialmente Nublado', wmo_3:'Nublado',
    wmo_fog:'Niebla', wmo_drizzle:'Llovizna', wmo_rain:'Lluvia', wmo_snow:'Nieve',
    wmo_rain_showers:'Chubascos', wmo_snow_showers:'Nevadas', wmo_thunderstorm:'Tormenta Eléctrica',
    ck_earthquake_reason:'Basado en actividad sísmica detectada en su área',
    ck_wildfire_reason:'Incendios forestales detectados en su región',
    ck_flood_reason:'Inundaciones detectadas cerca de su región',
    ck_volcano_reason:'Actividad volcánica detectada cerca de su región',
    ck_winter_storm_reason:'Riesgo o alertas de tormenta de invierno detectados',
    ck_hurricane_reason:'Riesgo o alertas de huracán detectados',
    ck_tornado_reason:'Riesgo o alertas de tornado detectados',
    ck_extreme_heat_reason:'Alertas de calor extremo activas en la región',
    ck_storm_reason:'Eventos de tormenta detectados en la región',
    ck_drought_reason:'Condiciones de sequía detectadas en la región',
    ck_severe_weather_reason:'Riesgo general de clima severo para esta región',
    ck_earthquake_items:['Agua — 1 galón/persona/día por 3+ días','Comida no perecedera (suministro de 3 días)','Linterna + pilas de repuesto','Botiquín de primeros auxilios con manual','Llave o alicates para cerrar servicios','Mascarillas N95','Zapatos resistentes para cada miembro del hogar','Lista de contactos de emergencia (impresa)','Copias de documentos en bolsa impermeable','Conocer los cierres de gas/agua del hogar','Anclar muebles pesados a las paredes','Identificar lugares seguros en cada habitación (bajo mesas resistentes)'],
    ck_wildfire_items:['Mascarillas N95 contra inhalación de humo','Bolsa de 72 horas lista para llevar','Documentos importantes en contenedor ignífugo','Cargador portátil + cables','Suministro de medicamentos para 30 días si es posible','Conocer 2+ rutas de evacuación desde casa','Registrarse para alertas de emergencia locales','Extintor ABC (10 lb)','Despejar vegetación a 9+ metros de la estructura','Efectivo en billetes pequeños','Kit para mascotas (comida, agua, registros veterinarios, transportín)','Mapa en papel de su área'],
    ck_flood_items:['Bolsa impermeable para documentos vitales','Agua extra (las inundaciones contaminan el suministro)','Sacos de arena o barreras contra inundaciones','Radio meteorológica de batería/manivela','Conocer su zona de inundación FEMA','Elevar paneles eléctricos si es propenso a inundaciones','Bomba de sumidero con batería de respaldo','Botas de goma + guantes impermeables','Verificar seguro contra inundaciones (NFIP)','Lona impermeable (mín. 8×10 pies)','Contactos de emergencia para corte de servicios','Plástico + cinta adhesiva'],
    ck_volcano_items:['Gafas protectoras contra ceniza','Mascarillas N95+ (la ceniza es un peligro respiratorio grave)','Ropa de manga larga + pantalones largos','Conocer las zonas de evacuación de flujos de lava locales','Suscribirse a notificaciones de alertas volcánicas','Plástico para sellar ventilaciones de ceniza','Suministro de agua de 3 días (la ceniza contamina el agua)','Mascarillas para mascotas','Filtros de aire HVAC extra'],
    ck_winter_storm_items:['Sal vial o arena para caminos','Pala para nieve + raspador de hielo para vehículo','Ropa de abrigo (lana/sintética — no algodón)','Kit de emergencia para auto (manta, pala, cables puente)','Fuente de calor de respaldo (sin monóxido de carbono)','Comida + agua para 3 días en caso de cierre de vías','Cobijas + bolsas de dormir extra','Aislar tuberías expuestas','Conocer los primeros auxilios para hipotermia','Verificar el estado de vecinos mayores'],
    ck_hurricane_items:['Suministro de comida + agua para 7 días (1 galón/persona/día)','Estación de energía portátil o generador','Protectores para huracán o madera para ventanas','Conocer su zona de marejada ciclónica + refugio','Tanque lleno antes de la temporada de tormentas','Podar árboles cerca de la estructura','Radio meteorológica NOAA (a pilas)','Efectivo de emergencia','Almacenamiento impermeable de documentos','Botiquín de primeros auxilios + medicamentos'],
    ck_tornado_items:['Habitación de refugio designada (interior, piso más bajo, sin ventanas)','Casco para protegerse de escombros','Zapatos cerrados resistentes','Radio NOAA o aplicación de alertas confiable','Practicar un simulacro de tornado familiar','Botiquín de primeros auxilios','Batería de respaldo para teléfono','Conocer la diferencia entre vigilancia y advertencia de tornado'],
    ck_extreme_heat_items:['Ventiladores, AC portátil o centros de enfriamiento locales','Bebidas electrolíticas / sales de rehidratación oral','Ropa holgada de colores claros','Cortinas opacas para reducir el calor interior','Reconocer signos y tratamiento del golpe de calor','Revisar regularmente a personas mayores y niños pequeños','Nunca dejar personas o mascotas en vehículos estacionados','Protector solar FPS 30+','Planificar actividades al aire libre para temprano en la mañana'],
    ck_storm_items:['Radio meteorológica a pilas','Protectores de sobretensión para electrónicos','Bolsa de 72 horas','Botiquín de primeros auxilios','Suministro de comida + agua para 3 días','Linterna + pilas extra','Conocer los refugios locales','Cargador portátil para teléfono'],
    ck_drought_items:['Plan de conservación de agua (accesorios de bajo flujo)','Sistema de recolección de agua de lluvia','Paisajismo resistente a la sequía','Conocer las restricciones de agua locales','Contenedores grandes de almacenamiento de agua','Paisajismo inteligente contra incendios (la sequía aumenta el riesgo)'],
    ck_severe_weather_items:['Radio meteorológica a pilas','Bolsa de emergencia de 72 horas','Botiquín de primeros auxilios','Copias de respaldo de documentos importantes','Conocer los refugios de emergencia locales','Suministro de comida + agua para 3 días','Linterna + pilas','Cargador portátil para teléfono'],
    ck_universal_items:['Botiquín de primeros auxilios con manual impreso','Copias de ID, seguro y registros médicos','Bolsa de 72 horas por miembro del hogar','Lista de contactos de emergencia impresa','Radio de batería o de manivela','Cargador portátil para teléfono'],
    lp_slogan:'Tu región. Tus riesgos. Tu plan.',
    lp_sub:'Datos de desastres en tiempo real, análisis de riesgos personalizado y herramientas de preparación — construidos en torno a tu ubicación exacta, gratis.',
    lp_cta_start:'Comenzar →',
    lp_no_bs:'Sin cuenta requerida · Gratis para siempre',
    lp_source_label:'Datos en vivo de',
    lp_section_tag:'Por qué elegir esto',
    lp_section_title:'No es otra app genérica de emergencias',
    lp_section_sub:'La mayoría de las apps muestran titulares nacionales. Nosotros analizamos lo que ocurre en un radio de 400 km de tu dirección exacta.',
    lp_panel1_title:'Datos de Desastres en Vivo',
    lp_panel1_desc:'Obtiene datos de terremotos de USGS, eventos naturales de NASA EONET y alertas meteorológicas activas de NWS en tiempo real — cada vez que buscas.',
    lp_panel2_title:'Análisis de Riesgo Hiperlocal',
    lp_panel2_desc:'Los eventos en un radio de 400 km alrededor de tus coordenadas exactas se clasifican por frecuencia y severidad ponderada — no por promedios nacionales.',
    lp_panel3_title:'Listas Personalizadas',
    lp_panel3_desc:'Tu lista de preparación se construye a partir de tu perfil de riesgo regional. ¿Zona sísmica? Recibes elementos para terremotos. ¿Área de incendios? Igual.',
    lp_panel4_title:'Educación sobre Desastres',
    lp_panel4_desc:'Guías detalladas para 12 tipos de desastres naturales — causas, señales de advertencia, qué hacer durante y después — respaldadas por fuentes oficiales.',
    lp_panel5_title:'Clima y Alertas Activas',
    lp_panel5_desc:'Condiciones actuales y alertas de emergencia NWS en vivo para tu área, más un mapa interactivo para visualizar eventos de desastre históricos a lo largo del tiempo.',
    lp_panel6_title:'Rastreador del Hogar',
    lp_panel6_desc:'Crea grupos familiares, rastrea el progreso de preparación de cada miembro y sincroniza en tiempo real entre dispositivos — sin necesidad de registro.',
    lp_bottom_title:'¿Listo para ver qué ocurre en tu región?',
    lp_bottom_sub:'Solo ingresa tu ciudad. Tarda menos de 10 segundos.',
    lp_bottom_cta:'Ver Mi Región →',
    scroll_hint:'Desplázate para ver más',
    home_btn:'🏠 Inicio',
  },
  fr: {
    lang_name:'FR', header_subtitle:'Sensibilisation aux catastrophes et liste de préparation en temps réel',
    search_label:'Rechercher votre région', search_placeholder:'Ville, état ou code postal…',
    search_btn:'Rechercher', geo_btn:'📍 Utiliser ma position',
    empty_title:'Recherchez votre région pour commencer',
    empty_msg:'Entrez une ville ou utilisez votre position pour voir les événements récents,<br>une analyse des risques et une liste de préparation personnalisée.',
    loading_title:'Récupération des données régionales…',
    loading_msg:'Interrogation des séismes USGS, événements NASA EONET<br>et alertes météo NWS',
    map_title:'🗺️ Carte des Événements', time_machine:'⏱ Machine à Remonter le Temps', all_time:'Toute la période',
    play:'▶ Lire', pause:'⏸ Pause',
    stat_quakes:'Séismes', stat_fires:'Incendies', stat_floods:'Inondations', stat_alerts:'Alertes',
    risks_title:'⚠️ Principaux Risques Régionaux',
    day_btn:'Jour', week_btn:'Semaine', month_btn:'Mois', yr_unit:'an',
    tracker_title:'👨‍👩‍👧 Suivi du Ménage',
    family_placeholder:'Nom de la nouvelle famille…', add_family_btn:'+ Famille',
    join_placeholder:'Entrez un code pour rejoindre…', join_btn:'Rejoindre',
    disasters_nav_btn:'🌋 Catastrophes Naturelles',
    weather_nav_btn:'⛅ Météo', checklist_nav_btn:'✅ Liste de Préparation',
    back_menu:'← Retour au Menu', back_results:'← Résultats',
    checklist_title:'✅ Liste de Préparation',
    checklist_subtitle:'Adaptée à vos risques régionaux · cochez les éléments au fur et à mesure',
    overall_prep:'Préparation Globale',
    weather_title:'⛅ Météo Actuelle', wind_speed:'Vitesse du Vent', precipitation:'Précipitations', feels_like:'Ressenti',
    share_btn:'🔗 Partager', save_report_btn:'💾 Enregistrer le Rapport',
    no_events:'Aucun événement significatif détecté dans cette région pour la période sélectionnée.',
    weighted_event:'événement pondéré', weighted_events:'événements pondérés',
    conf_high:'Haute confiance', conf_med:'Confiance moyenne', conf_low:'Faible confiance',
    universal_name:'Éléments Universels', universal_reason:"S'applique à tout type d'urgence", reset_btn:'↺ Réinitialiser',
    risk_earthquake:'Séisme', risk_wildfire:'Incendie de Forêt', risk_flood:'Inondation', risk_volcano:'Volcan',
    risk_storm:'Tempête Sévère', risk_drought:'Sécheresse', risk_tornado:'Tornade', risk_hurricane:'Ouragan',
    risk_winter_storm:'Tempête Hivernale', risk_extreme_heat:'Chaleur Extrême', risk_severe_weather:'Météo Sévère',
    wmo_0:'Ciel Dégagé', wmo_1:'Principalement Dégagé', wmo_2:'Partiellement Nuageux', wmo_3:'Couvert',
    wmo_fog:'Brouillard', wmo_drizzle:'Bruine', wmo_rain:'Pluie', wmo_snow:'Neige',
    wmo_rain_showers:'Averses de Pluie', wmo_snow_showers:'Averses de Neige', wmo_thunderstorm:'Orage',
    ck_earthquake_reason:"Basé sur l'activité sismique détectée dans votre zone",
    ck_wildfire_reason:'Incendies de forêt détectés dans votre région',
    ck_flood_reason:'Inondations détectées près de votre région',
    ck_volcano_reason:'Activité volcanique détectée près de votre région',
    ck_winter_storm_reason:'Risque de tempête hivernale ou alertes détectés',
    ck_hurricane_reason:"Risque d'ouragan ou alertes détectés",
    ck_tornado_reason:'Risque de tornade ou alertes détectés',
    ck_extreme_heat_reason:'Alertes de chaleur extrême actives dans la région',
    ck_storm_reason:'Événements orageux détectés dans la région',
    ck_drought_reason:'Conditions de sécheresse détectées dans la région',
    ck_severe_weather_reason:'Risque général de météo sévère pour cette région',
    ck_earthquake_items:["Eau — 1 gallon/personne/jour pendant 3+ jours","Nourriture non périssable (provision de 3 jours)","Lampe de poche + piles de rechange","Trousse de premiers secours avec manuel","Clé ou pince pour couper les services","Masques anti-poussière N95","Chaussures robustes pour chaque membre du ménage","Liste de contacts d'urgence (imprimée)","Copies de documents dans un sac imperméable","Connaître les vannes de gaz/eau de votre domicile","Fixer les meubles lourds aux murs","Identifier les zones sûres dans chaque pièce (sous des tables solides)"],
    ck_wildfire_items:["Masques N95 contre l'inhalation de fumée","Sac de 72h prêt à emporter","Documents importants dans un conteneur ignifuge","Chargeur de téléphone portable + câbles","Provision de médicaments pour 30 jours si possible","Connaître 2+ itinéraires d'évacuation depuis chez soi","S'inscrire aux alertes d'urgence locales","Extincteur ABC (10 lb)","Débroussailler à 9+ m de la structure","Espèces en petites coupures","Kit pour animaux de compagnie (nourriture, eau, dossiers vétérinaires, cage)","Carte papier de votre zone"],
    ck_flood_items:["Sac imperméable pour documents vitaux","Eau supplémentaire (les inondations contaminent l'eau)","Sacs de sable ou barrières contre les inondations","Radio météo à piles/manivelle","Connaître votre zone inondable FEMA","Suréléver les tableaux électriques si zone inondable","Pompe de puisard avec batterie de secours","Bottes en caoutchouc + gants imperméables","Vérifier l'assurance inondation (NFIP)","Bâche imperméable (min 2,4×3 m)","Contacts d'urgence pour coupure des services","Feuille plastique + ruban adhésif"],
    ck_volcano_items:["Lunettes de protection contre les cendres","Masques N95+ (les cendres sont un risque respiratoire grave)","Vêtements à manches longues + pantalons longs","Connaître les zones d'évacuation des coulées de lave locales","S'inscrire aux notifications d'alerte volcanique","Feuille plastique pour sceller les bouches d'air contre les cendres","Provision d'eau de 3 jours (les cendres contaminent l'eau)","Masques pour animaux de compagnie","Filtres d'air HVAC supplémentaires"],
    ck_winter_storm_items:["Sel de déneigement ou sable pour les allées","Pelle à neige + grattoir de véhicule","Couches chaudes (laine/synthétique — pas de coton)","Kit d'urgence pour voiture (couverture, pelle, câbles de démarrage)","Source de chaleur de secours (sans monoxyde de carbone)","Nourriture + eau pour 3 jours en cas de fermeture des routes","Couvertures + sacs de couchage supplémentaires","Isoler les tuyaux exposés","Connaître les premiers secours pour l'hypothermie","Vérifier l'état des voisins âgés"],
    ck_hurricane_items:["Provision de nourriture + eau pour 7 jours (1 gallon/personne/jour)","Station d'énergie portable ou générateur","Volets anti-ouragan ou contreplaqué pour les fenêtres","Connaître votre zone de submersion + abri","Plein d'essence avant la saison des tempêtes","Tailler les arbres près de la structure","Radio météo NOAA (à piles)","Espèces d'urgence","Stockage imperméable de documents","Trousse de premiers secours + médicaments"],
    ck_tornado_items:["Pièce refuge désignée (intérieure, étage le plus bas, sans fenêtres)","Casque pour se protéger des débris","Chaussures fermées robustes","Radio NOAA ou application d'alertes fiable","Pratiquer un exercice tornado familial","Trousse de premiers secours","Batterie de secours pour téléphone","Connaître la différence entre veille et alerte tornado"],
    ck_extreme_heat_items:["Ventilateurs, climatiseur portable ou centres de rafraîchissement locaux","Boissons électrolytiques / sels de réhydratation orale","Vêtements amples de couleur claire","Rideaux occultants pour réduire la chaleur intérieure","Reconnaître les signes du coup de chaleur + traitement","Surveiller régulièrement les personnes âgées + les jeunes enfants","Ne jamais laisser des personnes ou des animaux dans des véhicules garés","Écran solaire SPF 30+","Planifier les activités en plein air tôt le matin"],
    ck_storm_items:["Radio météo à piles","Parasurtenseurs pour les appareils électroniques","Sac de 72h","Trousse de premiers secours","Provision de nourriture + eau pour 3 jours","Lampe de poche + piles supplémentaires","Connaître les abris locaux","Chargeur de téléphone portable"],
    ck_drought_items:["Plan de conservation de l'eau (robinets basse consommation)","Système de récupération des eaux de pluie","Aménagement paysager résistant à la sécheresse","Connaître les restrictions d'eau locales","Grands conteneurs de stockage d'eau","Aménagement paysager anti-incendie (la sécheresse augmente le risque)"],
    ck_severe_weather_items:["Radio météo à piles","Sac d'urgence de 72h","Trousse de premiers secours","Copies de sauvegarde de documents importants","Connaître les abris d'urgence locaux","Provision de nourriture + eau pour 3 jours","Lampe de poche + piles","Chargeur de téléphone portable"],
    ck_universal_items:["Trousse de premiers secours avec manuel imprimé","Copies de pièce d'identité, assurance et dossiers médicaux","Sac de 72h par membre du ménage","Liste de contacts d'urgence imprimée","Radio à piles ou à manivelle","Chargeur de téléphone portable"],
    lp_slogan:'Votre région. Vos risques. Votre plan.',
    lp_sub:'Données de catastrophes en temps réel, analyse des risques personnalisée et outils de préparation — construits autour de votre localisation exacte, gratuitement.',
    lp_cta_start:'Commencer →',
    lp_no_bs:'Sans compte requis · Gratuit pour toujours',
    lp_source_label:'Données en direct de',
    lp_section_tag:'Pourquoi nous choisir',
    lp_section_title:"Pas encore une app d'urgence générique",
    lp_section_sub:"La plupart des apps affichent des actualités nationales. Nous analysons ce qui se passe dans un rayon de 400 km de votre adresse exacte.",
    lp_panel1_title:'Données de Catastrophes en Direct',
    lp_panel1_desc:"Récupère les données sismiques de l'USGS, les événements naturels de la NASA EONET et les alertes météo actives du NWS en temps réel — à chaque recherche.",
    lp_panel2_title:'Analyse de Risque Hyper-Locale',
    lp_panel2_desc:'Les événements dans un rayon de 400 km autour de vos coordonnées exactes sont classés par fréquence et gravité pondérée — pas par des moyennes nationales.',
    lp_panel3_title:'Listes de Contrôle Personnalisées',
    lp_panel3_desc:"Votre liste de préparation est construite à partir de votre profil de risque régional. Zone sismique ? Vous obtenez des éléments pour les séismes. Zone d'incendies ? Même principe.",
    lp_panel4_title:'Éducation sur les Catastrophes',
    lp_panel4_desc:'Guides détaillés pour 12 types de catastrophes naturelles — causes, signaux d\'alerte, que faire pendant et après — appuyés par des sources officielles.',
    lp_panel5_title:'Météo & Alertes Actives',
    lp_panel5_desc:'Conditions actuelles et alertes d\'urgence NWS en direct pour votre zone, plus une carte interactive pour visualiser les événements historiques au fil du temps.',
    lp_panel6_title:'Suivi du Ménage',
    lp_panel6_desc:'Créez des groupes familiaux, suivez les progrès de préparation de chaque membre et synchronisez en temps réel sur tous les appareils — sans inscription.',
    lp_bottom_title:'Prêt à voir ce qui se passe dans votre région ?',
    lp_bottom_sub:'Entrez simplement votre ville. Moins de 10 secondes.',
    lp_bottom_cta:'Vérifier Ma Région →',
    scroll_hint:'Défiler pour voir plus',
    home_btn:'🏠 Accueil',
  },
  de: {
    lang_name:'DE', header_subtitle:'Echtzeit-Katastrophenbewusstsein & Vorbereitungscheckliste',
    search_label:'Ihre Region suchen', search_placeholder:'Stadt, Bundesland oder Postleitzahl…',
    search_btn:'Suchen', geo_btn:'📍 Meinen Standort verwenden',
    empty_title:'Suchen Sie Ihre Region, um zu beginnen',
    empty_msg:'Geben Sie eine Stadt ein oder verwenden Sie Ihren Standort, um aktuelle Katastrophenereignisse,<br>eine Risikoanalyse und eine personalisierte Vorbereitungsliste zu sehen.',
    loading_title:'Regionale Daten werden abgerufen…',
    loading_msg:'Abfrage von USGS-Erdbeben, NASA EONET-Naturereignissen<br>und NWS-Wetterwarnungen',
    map_title:'🗺️ Ereigniskarte', time_machine:'⏱ Zeitmaschine', all_time:'Gesamter Zeitraum',
    play:'▶ Abspielen', pause:'⏸ Pause',
    stat_quakes:'Erdbeben', stat_fires:'Waldbrände', stat_floods:'Überschwemmungen', stat_alerts:'Warnungen',
    risks_title:'⚠️ Wichtigste Regionale Risiken',
    day_btn:'Tag', week_btn:'Woche', month_btn:'Monat', yr_unit:'J.',
    tracker_title:'👨‍👩‍👧 Haushalts-Tracker',
    family_placeholder:'Neuer Familienname…', add_family_btn:'+ Familie',
    join_placeholder:'Code eingeben, um beizutreten…', join_btn:'Beitreten',
    disasters_nav_btn:'🌋 Naturkatastrophen',
    weather_nav_btn:'⛅ Wetter', checklist_nav_btn:'✅ Vorbereitungs-Checkliste',
    back_menu:'← Zurück zum Menü', back_results:'← Ergebnisse',
    checklist_title:'✅ Vorbereitungs-Checkliste',
    checklist_subtitle:'Auf Ihre regionalen Risiken zugeschnitten · Haken Sie Elemente ab, während Sie Ihr Kit zusammenstellen',
    overall_prep:'Gesamtvorbereitung',
    weather_title:'⛅ Aktuelles Wetter', wind_speed:'Windgeschwindigkeit', precipitation:'Niederschlag', feels_like:'Gefühlt wie',
    share_btn:'🔗 Teilen', save_report_btn:'💾 Bericht Speichern',
    no_events:'Keine bedeutenden Ereignisse in dieser Region für den gewählten Zeitraum erkannt.',
    weighted_event:'gewichtetes Ereignis', weighted_events:'gewichtete Ereignisse',
    conf_high:'Hohe Konfidenz', conf_med:'Mittlere Konfidenz', conf_low:'Niedrige Konfidenz',
    universal_name:'Universelle Grundausstattung', universal_reason:'Gilt für jeden Notfalltyp', reset_btn:'↺ Zurücksetzen',
    risk_earthquake:'Erdbeben', risk_wildfire:'Waldbrand', risk_flood:'Überschwemmung', risk_volcano:'Vulkan',
    risk_storm:'Schwerer Sturm', risk_drought:'Dürre', risk_tornado:'Tornado', risk_hurricane:'Hurrikan',
    risk_winter_storm:'Wintersturm', risk_extreme_heat:'Extreme Hitze', risk_severe_weather:'Schweres Unwetter',
    wmo_0:'Klarer Himmel', wmo_1:'Überwiegend Klar', wmo_2:'Teils Bewölkt', wmo_3:'Bedeckt',
    wmo_fog:'Neblig', wmo_drizzle:'Nieselregen', wmo_rain:'Regen', wmo_snow:'Schnee',
    wmo_rain_showers:'Regenschauer', wmo_snow_showers:'Schneeschauer', wmo_thunderstorm:'Gewitter',
    ck_earthquake_reason:'Basierend auf seismischer Aktivität in Ihrer Region',
    ck_wildfire_reason:'Waldbrandereignisse in Ihrer Region erkannt',
    ck_flood_reason:'Überschwemmungen in Ihrer Nähe erkannt',
    ck_volcano_reason:'Vulkanische Aktivität in Ihrer Nähe erkannt',
    ck_winter_storm_reason:'Wintersturmrisiko oder Warnungen erkannt',
    ck_hurricane_reason:'Hurrikanrisiko oder Warnungen erkannt',
    ck_tornado_reason:'Tornadorisiko oder Warnungen erkannt',
    ck_extreme_heat_reason:'Hitzewarnung in der Region aktiv',
    ck_storm_reason:'Sturmereignisse in der Region erkannt',
    ck_drought_reason:'Dürrebedingungen in der Region erkannt',
    ck_severe_weather_reason:'Allgemeines Unwetterrisiko für diese Region',
    ck_earthquake_items:['Wasser — 1 Gallon/Person/Tag für 3+ Tage','Haltbare Lebensmittel (Vorrat für 3 Tage)','Taschenlampe + Ersatzbatterien','Erste-Hilfe-Set mit Handbuch','Schraubenschlüssel oder Zange zum Absperren von Versorgungsleitungen','N95-Staubmasken','Robuste Schuhe für jedes Haushaltsmitglied','Notfallkontaktliste (gedruckt)','Kopien von Dokumenten in wasserdichter Tasche','Gas-/Wasserabsperrungen im Haus kennen','Schwere Möbel an der Wand befestigen','Sichere Plätze in jedem Raum identifizieren (unter stabilen Tischen)'],
    ck_wildfire_items:['N95-Masken gegen Raucheinatmung','72-Stunden-Notfallrucksack griffbereit','Wichtige Dokumente in feuerfestem Behälter','Tragbares Ladegerät + Kabel','Medikamentenvorrat für 30 Tage wenn möglich','2+ Evakuierungsrouten von zu Hause kennen','Für lokale Notfallwarnungen registrieren','ABC-Feuerlöscher (10 Pfund)','Vegetation 9+ m vom Gebäude entfernen','Bargeld in kleinen Scheinen','Tierkit (Futter, Wasser, Tierarztunterlagen, Transportbox)','Papierkarte der Umgebung'],
    ck_flood_items:['Wasserdichte Tasche für wichtige Dokumente','Zusätzliches Wasser (Überschwemmungen verunreinigen Leitungswasser)','Sandsäcke oder Hochwasserschutz für Eingänge','Akku-/Kurbelwetterradio','Eigene FEMA-Hochwasserzone kennen','Elektrische Schalttafeln anheben wenn hochwassergefährdet','Sumpfpumpe mit Akkusicherung','Gummistiefel + wasserdichte Handschuhe','Hochwasserversicherung prüfen (NFIP)','Wasserdichte Plane (min. 2,4×3 m)','Notfallkontakte für Versorgungsabsperrung','Plastikfolie + Klebeband'],
    ck_volcano_items:['Schutzbrille gegen Asche','N95+-Masken (Asche ist ein ernstes Atemwegsgefahr)','Langarmkleidung + lange Hosen','Lokale Evakuierungszonen für Lavaströme kennen','Für vulkanische Benachrichtigungen anmelden','Plastikfolie zum Abdichten von Lüftungsschlitzen gegen Asche','Wasservorrat für 3 Tage (Asche verunreinigt Wasser)','Staubmasken für Haustiere','Zusätzliche HVAC-Luftfilter'],
    ck_winter_storm_items:['Streusalz oder Sand für Wege','Schneeschaufel + Fahrzeug-Eiskratzer','Warme Schichten (Wolle/Kunstfaser — kein Baumwolle)','Auto-Notfallkit (Decke, Schaufel, Überbrückungskabel)','Notheizquelle (CO-sicher)','Essen + Wasser für 3 Tage bei Straßensperrungen','Extra Decken + Schlafsäcke','Freiliegende Rohre isolieren','Unterkühlung-Erste-Hilfe kennen','Ältere Nachbarn überprüfen'],
    ck_hurricane_items:['Essen + Wasser für 7 Tage (1 Gallon/Person/Tag)','Tragbare Powerstation oder Generator','Hurrikanschutzläden oder Sperrholz für Fenster','Sturmflutzonen + Schutzraum kennen','Vollgetanktes Fahrzeug vor der Sturmsaison','Bäume in Gebäudenähe beschneiden','NOAA-Wetterradio (batteriebetrieben)','Notfallbargeld','Wasserdichte Dokumentenaufbewahrung','Erste-Hilfe-Set + Medikamente'],
    ck_tornado_items:['Designierter Schutzraum (innen, tiefstes Stockwerk, keine Fenster)','Helm zum Schutz vor Trümmern','Robuste geschlossene Schuhe','NOAA-Wetterradio oder zuverlässige Warn-App','Tornado-Übung mit dem Haushalt durchführen','Erste-Hilfe-Set','Akkusicherung für Telefon','Unterschied zwischen Tornado-Warnung und -Alarm kennen'],
    ck_extreme_heat_items:['Ventilatoren, tragbare Klimaanlage oder lokale Kühlzentren','Elektrolytgetränke / orale Rehydratationslösungen','Helle, luftige Kleidung','Verdunkelungsvorhänge zur Reduzierung der Innenhitze','Hitzschlag-Symptome erkennen + Behandlung','Ältere Menschen + Kleinkinder regelmäßig kontrollieren','Niemals Menschen oder Tiere in geparkten Fahrzeugen lassen','Sonnenschutz LSF 30+','Outdoor-Aktivitäten für früh morgens planen'],
    ck_storm_items:['Batteriebetriebenes Wetterradio','Überspannungsschutz für Elektronik','72-Stunden-Notfallrucksack','Erste-Hilfe-Set','Essen + Wasser für 3 Tage','Taschenlampe + Ersatzbatterien','Lokale Schutzräume kennen','Tragbares Ladegerät'],
    ck_drought_items:['Wassersparplan (Wassersparende Armaturen)','Regenwassersammelsystem','Dürreresistente Bepflanzung','Lokale Wassereinschränkungen kennen','Große Wasserbehälter','Feuerschutz-Landschaftsgestaltung (Dürre erhöht Brandrisiko)'],
    ck_severe_weather_items:['Batteriebetriebenes Wetterradio','72-Stunden-Notfallrucksack','Erste-Hilfe-Set','Backup-Kopien wichtiger Dokumente','Lokale Notunterkünfte kennen','Essen + Wasser für 3 Tage','Taschenlampe + Batterien','Tragbares Ladegerät'],
    ck_universal_items:['Erste-Hilfe-Set mit gedrucktem Handbuch','Kopien von Ausweis, Versicherung und Krankenakten','72-Stunden-Notfallrucksack pro Haushaltsmitglied','Gedruckte Notfallkontaktliste','Batterie- oder Kurbelradio','Tragbares Ladegerät'],
    lp_slogan:'Ihre Region. Ihre Risiken. Ihr Plan.',
    lp_sub:'Echtzeit-Katastrophendaten, personalisierte Risikoanalyse und Vorbereitungstools — zugeschnitten auf Ihren genauen Standort, kostenlos.',
    lp_cta_start:'Jetzt starten →',
    lp_no_bs:'Kein Konto erforderlich · Kostenlos für immer',
    lp_source_label:'Live-Daten von',
    lp_section_tag:'Warum uns wählen',
    lp_section_title:'Keine weitere generische Notfall-App',
    lp_section_sub:'Die meisten Apps zeigen nationale Schlagzeilen. Wir analysieren, was in einem Umkreis von 400 km um Ihre genaue Adresse passiert.',
    lp_panel1_title:'Live-Katastrophendaten',
    lp_panel1_desc:'Ruft in Echtzeit Erdbebendaten von USGS, Naturereignisse von NASA EONET und aktive Wetterwarnungen vom NWS ab — bei jeder Suche.',
    lp_panel2_title:'Hyperlokale Risikoanalyse',
    lp_panel2_desc:'Ereignisse in einem Umkreis von 400 km um Ihre genauen Koordinaten werden nach Häufigkeit und gewichtetem Schweregrad eingestuft — nicht nach nationalen Durchschnittswerten.',
    lp_panel3_title:'Personalisierte Checklisten',
    lp_panel3_desc:'Ihre Vorbereitungsliste wird aus Ihrem regionalen Risikoprofil erstellt. Erdbebengebiet? Sie erhalten Erdbebenelemente. Waldbrandgebiet? Gleiches Prinzip.',
    lp_panel4_title:'Katastrophenaufklärung',
    lp_panel4_desc:'Detaillierte Leitfäden für 12 Arten von Naturkatastrophen — Ursachen, Warnzeichen, was während und danach zu tun ist — durch offizielle Quellen belegt.',
    lp_panel5_title:'Wetter & Aktive Warnungen',
    lp_panel5_desc:'Aktuelle Bedingungen und Live-NWS-Notfallwarnungen für Ihren Bereich, plus eine interaktive Karte zur Visualisierung historischer Katastrophenereignisse im Zeitverlauf.',
    lp_panel6_title:'Haushalts-Tracker',
    lp_panel6_desc:'Erstellen Sie Familiengruppen, verfolgen Sie den Vorbereitungsfortschritt jedes Mitglieds und synchronisieren Sie in Echtzeit geräteübergreifend — ohne Registrierung.',
    lp_bottom_title:'Bereit zu sehen, was in Ihrer Region passiert?',
    lp_bottom_sub:'Geben Sie einfach Ihre Stadt ein. Dauert unter 10 Sekunden.',
    lp_bottom_cta:'Meine Region prüfen →',
    scroll_hint:'Weiter scrollen',
    home_btn:'🏠 Startseite',
  },
  zh: {
    lang_name:'中文', header_subtitle:'实时灾害意识与备灾清单',
    search_label:'搜索您的地区', search_placeholder:'城市、州或邮编…',
    search_btn:'搜索', geo_btn:'📍 使用我的位置',
    empty_title:'搜索您的地区以开始',
    empty_msg:'输入城市或使用您的位置，查看近期灾害事件、<br>风险分析和个性化备灾清单。',
    loading_title:'正在获取区域数据…',
    loading_msg:'查询USGS地震、NASA EONET自然事件<br>及NWS天气警报',
    map_title:'🗺️ 事件地图', time_machine:'⏱ 时光机', all_time:'全部时间',
    play:'▶ 播放', pause:'⏸ 暂停',
    stat_quakes:'地震', stat_fires:'野火', stat_floods:'洪水', stat_alerts:'警报',
    risks_title:'⚠️ 主要区域风险',
    day_btn:'今日', week_btn:'本周', month_btn:'本月', yr_unit:'年',
    tracker_title:'👨‍👩‍👧 家庭追踪器',
    family_placeholder:'新家庭名称…', add_family_btn:'+ 家庭',
    join_placeholder:'输入代码加入家庭…', join_btn:'加入',
    disasters_nav_btn:'🌋 自然灾害',
    weather_nav_btn:'⛅ 天气', checklist_nav_btn:'✅ 备灾清单',
    back_menu:'← 返回菜单', back_results:'← 返回结果',
    checklist_title:'✅ 备灾清单',
    checklist_subtitle:'根据您的区域风险定制 · 逐项勾选以完善您的备灾包',
    overall_prep:'总体备灾情况',
    weather_title:'⛅ 当前天气', wind_speed:'风速', precipitation:'降水量', feels_like:'体感温度',
    share_btn:'🔗 分享', save_report_btn:'💾 保存报告',
    no_events:'在选定时间窗口内，此地区未检测到重大事件。',
    weighted_event:'加权事件', weighted_events:'加权事件',
    conf_high:'高置信度', conf_med:'中置信度', conf_low:'低置信度',
    universal_name:'通用必备物资', universal_reason:'适用于所有紧急情况类型', reset_btn:'↺ 重置',
    risk_earthquake:'地震', risk_wildfire:'野火', risk_flood:'洪水', risk_volcano:'火山',
    risk_storm:'强烈风暴', risk_drought:'干旱', risk_tornado:'龙卷风', risk_hurricane:'飓风',
    risk_winter_storm:'冬季风暴', risk_extreme_heat:'极端高温', risk_severe_weather:'严重天气',
    wmo_0:'晴天', wmo_1:'大致晴朗', wmo_2:'多云', wmo_3:'阴天',
    wmo_fog:'雾', wmo_drizzle:'毛毛雨', wmo_rain:'雨', wmo_snow:'雪',
    wmo_rain_showers:'阵雨', wmo_snow_showers:'阵雪', wmo_thunderstorm:'雷暴',
    ck_earthquake_reason:'基于您所在地区检测到的地震活动',
    ck_wildfire_reason:'您所在地区检测到野火事件',
    ck_flood_reason:'您所在地区附近检测到洪水事件',
    ck_volcano_reason:'您所在地区附近检测到火山活动',
    ck_winter_storm_reason:'检测到冬季风暴风险或警报',
    ck_hurricane_reason:'检测到飓风风险或警报',
    ck_tornado_reason:'检测到龙卷风风险或警报',
    ck_extreme_heat_reason:'该地区极端高温警报生效',
    ck_storm_reason:'该地区检测到风暴事件',
    ck_drought_reason:'该地区检测到干旱状况',
    ck_severe_weather_reason:'该地区存在一般性严重天气风险',
    ck_earthquake_items:['水 — 每人每天1加仑，储备3天以上','非易腐食品（3天供应量）','手电筒 + 备用电池','急救箱（含使用手册）','扳手或钳子（用于关闭公用设施阀门）','N95防尘口罩','每位家庭成员的坚固鞋子','紧急联系人名单（纸质版）','防水袋中的文件副本','了解家中煤气/水管的关闭方式','将重型家具固定在墙上','识别每个房间的安全位置（坚固桌子下方）'],
    ck_wildfire_items:['防烟雾吸入的N95口罩','72小时应急包（随时可取）','重要文件存放于防火容器中','便携式手机充电器 + 数据线','如可能，备足30天药品供应','了解从家中撤离的2条以上疏散路线','注册当地紧急警报','ABC灭火器（10磅）','清除建筑物周围9米内的植被','备有小额现金','宠物套装（食物、水、兽医记录、运输笼）','区域纸质地图'],
    ck_flood_items:['防水袋存放重要文件','额外饮用水（洪水会污染供水）','沙袋或防洪屏障用于出入口','电池/手摇天气收音机','了解您的FEMA洪水区划','如处于洪涝频发地区，应抬高配电盘','带备用电池的排水泵','橡胶靴 + 防水手套','检查洪水保险（NFIP）','防水篷布（最小2.4×3米）','公用设施紧急关闭联系人','塑料薄膜 + 胶带'],
    ck_volcano_items:['防火山灰的护目镜','N95+口罩（火山灰是严重的呼吸道危害）','长袖衣物 + 长裤','了解当地熔岩流疏散区','注册火山警报通知','用塑料薄膜封闭通风口防止火山灰进入','3天饮用水储备（火山灰会污染水源）','宠物防尘口罩','备用HVAC空气过滤器'],
    ck_winter_storm_items:['道路撒盐或沙子','铲雪工具 + 车辆除冰刮刀','保暖衣物（羊毛/合成纤维 — 非棉质）','车辆应急套装（毛毯、铲子、跨接电缆）','备用供暖设备（防一氧化碳中毒）','备足3天食物和水以防道路封闭','额外毛毯 + 睡袋','为外露管道保温','了解低体温症急救措施','关注老年邻居的状况'],
    ck_hurricane_items:['备足7天食物和水（每人每天1加仑）','便携式电源站或发电机','飓风防护板或窗户胶合板','了解您的风暴潮区域 + 避难所','风暴季节前加满油箱','修剪建筑物附近的树木','NOAA天气收音机（电池供电）','应急现金','防水文件存储','急救箱 + 药品'],
    ck_tornado_items:['指定避难室（内部、最低楼层、无窗）','保护头部免受碎片伤害的头盔','坚固的包头鞋','NOAA天气收音机或可靠警报应用','进行家庭龙卷风疏散演练','急救箱','手机备用电池','了解龙卷风预警与警报的区别'],
    ck_extreme_heat_items:['电风扇、便携式空调或当地降温中心位置','电解质饮料 / 口服补液盐','浅色宽松服装','遮光窗帘以降低室内温度','识别中暑症状及治疗方法','定期关注老年人和幼儿的状况','切勿将人员或宠物留在停放的车辆中','防晒系数30+的防晒霜','将户外活动安排在清晨'],
    ck_storm_items:['电池供电的天气收音机','电子设备防涌浪保护器','72小时应急包','急救箱','3天食物和水储备','手电筒 + 备用电池','了解当地避难所位置','便携式手机充电器'],
    ck_drought_items:['节水计划（低流量装置）','雨水收集系统','耐旱景观绿化','了解当地用水限制','大容量储水容器','防火景观绿化（干旱增加火灾风险）'],
    ck_severe_weather_items:['电池供电的天气收音机','72小时应急包','急救箱','重要文件的备份副本','了解当地紧急避难所位置','3天食物和水储备','手电筒 + 电池','便携式手机充电器'],
    ck_universal_items:['带印刷手册的急救箱','身份证、保险和医疗记录的副本','每位家庭成员的72小时应急包','印刷版紧急联系人名单','电池或手摇收音机','便携式手机充电器'],
    lp_slogan:'您的地区。您的风险。您的计划。',
    lp_sub:'实时灾害数据、个性化风险分析和备灾工具 — 专为您的精确位置定制，完全免费。',
    lp_cta_start:'立即开始 →',
    lp_no_bs:'无需注册 · 永久免费',
    lp_source_label:'实时数据来自',
    lp_section_tag:'为什么选择我们',
    lp_section_title:'不是又一个通用应急应用',
    lp_section_sub:'大多数应用显示全国性头条新闻。我们分析您精确地址周围400公里范围内发生的情况。',
    lp_panel1_title:'实时灾害数据',
    lp_panel1_desc:'实时从USGS获取地震数据、从NASA EONET获取自然事件，以及从NWS获取活跃天气警报 — 每次搜索均如此。',
    lp_panel2_title:'超本地化风险分析',
    lp_panel2_desc:'您精确坐标周围400公里范围内的事件按频率和加权严重程度排名 — 而非全国平均水平。',
    lp_panel3_title:'个性化清单',
    lp_panel3_desc:'您的备灾清单根据您的区域风险档案定制。地震区？您将获得地震专项物品。野火地区？同样如此。',
    lp_panel4_title:'灾害知识教育',
    lp_panel4_desc:'12种自然灾害的详细指南 — 原因、预警信号、期间和之后该做什么 — 均有官方资料支撑。',
    lp_panel5_title:'天气与活跃警报',
    lp_panel5_desc:'您所在地区的当前天气和NWS实时紧急警报，以及交互式地图以可视化历史灾害事件的时间变化。',
    lp_panel6_title:'家庭追踪器',
    lp_panel6_desc:'创建家庭群组，追踪每位成员的备灾进度，并跨设备实时同步 — 无需注册。',
    lp_bottom_title:'准备好查看您所在地区的情况了吗？',
    lp_bottom_sub:'只需输入您的城市，不到10秒即可完成。',
    lp_bottom_cta:'查看我的地区 →',
    scroll_hint:'向下滚动查看更多',
    home_btn:'🏠 主页',
  },
  pt: {
    lang_name:'PT', header_subtitle:'Monitoramento de desastres em tempo real e lista de preparação',
    search_label:'Pesquise sua região', search_placeholder:'Cidade, estado ou CEP…',
    search_btn:'Pesquisar', geo_btn:'📍 Usar Minha Localização',
    empty_title:'Pesquise sua região para começar',
    empty_msg:'Digite uma cidade ou use sua localização para ver eventos recentes,<br>uma análise de riscos e uma lista de preparação personalizada.',
    loading_title:'Buscando dados regionais…',
    loading_msg:'Consultando terremotos USGS, eventos NASA EONET<br>e alertas meteorológicos NWS',
    map_title:'🗺️ Mapa de Eventos', time_machine:'⏱ Máquina do Tempo', all_time:'Todo o período',
    play:'▶ Reproduzir', pause:'⏸ Pausar',
    stat_quakes:'Terremotos', stat_fires:'Incêndios', stat_floods:'Inundações', stat_alerts:'Alertas',
    risks_title:'⚠️ Principais Riscos Regionais',
    day_btn:'Dia', week_btn:'Semana', month_btn:'Mês', yr_unit:'ano',
    tracker_title:'👨‍👩‍👧 Rastreador Familiar',
    family_placeholder:'Nome da nova família…', add_family_btn:'+ Família',
    join_placeholder:'Digite o código para entrar…', join_btn:'Entrar',
    disasters_nav_btn:'🌋 Desastres Naturais',
    weather_nav_btn:'⛅ Clima', checklist_nav_btn:'✅ Lista de Preparação',
    back_menu:'← Voltar ao Menu', back_results:'← Resultados',
    checklist_title:'✅ Lista de Preparação',
    checklist_subtitle:'Adaptada aos seus riscos regionais · marque os itens ao montar seu kit',
    overall_prep:'Preparação Geral',
    weather_title:'⛅ Clima Atual', wind_speed:'Velocidade do Vento', precipitation:'Precipitação', feels_like:'Sensação Térmica',
    share_btn:'🔗 Compartilhar', save_report_btn:'💾 Salvar Relatório',
    no_events:'Nenhum evento significativo detectado nesta região para o período selecionado.',
    weighted_event:'evento ponderado', weighted_events:'eventos ponderados',
    conf_high:'Alta confiança', conf_med:'Confiança média', conf_low:'Baixa confiança',
    universal_name:'Essenciais Universais', universal_reason:'Aplica-se a todo tipo de emergência', reset_btn:'↺ Redefinir',
    risk_earthquake:'Terremoto', risk_wildfire:'Incêndio Florestal', risk_flood:'Inundação', risk_volcano:'Vulcão',
    risk_storm:'Tempestade Severa', risk_drought:'Seca', risk_tornado:'Tornado', risk_hurricane:'Furacão',
    risk_winter_storm:'Tempestade de Inverno', risk_extreme_heat:'Calor Extremo', risk_severe_weather:'Tempo Severo',
    wmo_0:'Céu Limpo', wmo_1:'Predominantemente Limpo', wmo_2:'Parcialmente Nublado', wmo_3:'Nublado',
    wmo_fog:'Neblina', wmo_drizzle:'Garoa', wmo_rain:'Chuva', wmo_snow:'Neve',
    wmo_rain_showers:'Pancadas de Chuva', wmo_snow_showers:'Pancadas de Neve', wmo_thunderstorm:'Tempestade',
    ck_earthquake_reason:'Baseado na atividade sísmica detectada em sua área',
    ck_wildfire_reason:'Incêndios florestais detectados em sua região',
    ck_flood_reason:'Inundações detectadas próximas à sua região',
    ck_volcano_reason:'Atividade vulcânica detectada próxima à sua região',
    ck_winter_storm_reason:'Risco de tempestade de inverno ou alertas detectados',
    ck_hurricane_reason:'Risco de furacão ou alertas detectados',
    ck_tornado_reason:'Risco de tornado ou alertas detectados',
    ck_extreme_heat_reason:'Alertas de calor extremo ativos na região',
    ck_storm_reason:'Eventos de tempestade detectados na região',
    ck_drought_reason:'Condições de seca detectadas na região',
    ck_severe_weather_reason:'Risco geral de tempo severo para esta região',
    lp_slogan:'Sua região. Seus riscos. Seu plano.',
    lp_sub:'Dados de desastres em tempo real, análise de riscos personalizada e ferramentas de preparação — desenvolvidas para sua localização exata, gratuitamente.',
    lp_cta_start:'Começar →', lp_no_bs:'Sem conta necessária · Gratuito para sempre',
    lp_source_label:'Dados ao vivo de', lp_section_tag:'Por que nos escolher',
    lp_section_title:'Não é mais um app genérico de emergências',
    lp_section_sub:'A maioria dos apps mostra manchetes nacionais. Analisamos o que está acontecendo em um raio de 400 km do seu endereço exato.',
    lp_panel1_title:'Dados de Desastres ao Vivo',
    lp_panel1_desc:'Obtém dados de terremotos do USGS, eventos naturais da NASA EONET e alertas meteorológicos ativos do NWS em tempo real — a cada pesquisa.',
    lp_panel2_title:'Análise de Risco Hiperlocal',
    lp_panel2_desc:'Eventos em um raio de 400 km ao redor das suas coordenadas exatas são classificados por frequência e severidade ponderada — não por médias nacionais.',
    lp_panel3_title:'Listas Personalizadas',
    lp_panel3_desc:'Sua lista de preparação é construída a partir do seu perfil de risco regional. Zona sísmica? Você recebe itens para terremotos. Área de incêndios? Mesma ideia.',
    lp_panel4_title:'Educação sobre Desastres',
    lp_panel4_desc:'Guias detalhados para 12 tipos de desastres naturais — causas, sinais de alerta, o que fazer durante e depois — respaldados por fontes oficiais.',
    lp_panel5_title:'Clima e Alertas Ativos',
    lp_panel5_desc:'Condições atuais e alertas de emergência NWS ao vivo para sua área, mais um mapa interativo para visualizar eventos históricos de desastres ao longo do tempo.',
    lp_panel6_title:'Rastreador Familiar',
    lp_panel6_desc:'Crie grupos familiares, acompanhe o progresso de preparação de cada membro e sincronize em tempo real entre dispositivos — sem necessidade de cadastro.',
    lp_bottom_title:'Pronto para ver o que está acontecendo na sua região?',
    lp_bottom_sub:'Basta digitar sua cidade. Leva menos de 10 segundos.',
    lp_bottom_cta:'Ver Minha Região →', scroll_hint:'Role para ver mais', home_btn:'🏠 Início',
  },
  it: {
    lang_name:'IT', header_subtitle:'Monitoraggio disastri in tempo reale e lista di preparazione',
    search_label:'Cerca la tua regione', search_placeholder:'Città, regione o CAP…',
    search_btn:'Cerca', geo_btn:'📍 Usa la Mia Posizione',
    empty_title:'Cerca la tua regione per iniziare',
    empty_msg:"Inserisci una città o usa la tua posizione per vedere gli eventi recenti,<br>un'analisi dei rischi e una lista di preparazione personalizzata.",
    loading_title:'Recupero dati regionali…',
    loading_msg:'Interrogazione terremoti USGS, eventi NASA EONET<br>e allerte meteo NWS',
    map_title:'🗺️ Mappa degli Eventi', time_machine:'⏱ Macchina del Tempo', all_time:'Tutto il periodo',
    play:'▶ Riproduci', pause:'⏸ Pausa',
    stat_quakes:'Terremoti', stat_fires:'Incendi', stat_floods:'Alluvioni', stat_alerts:'Allerte',
    risks_title:'⚠️ Principali Rischi Regionali',
    day_btn:'Giorno', week_btn:'Settimana', month_btn:'Mese', yr_unit:'anno',
    tracker_title:'👨‍👩‍👧 Tracker Familiare',
    family_placeholder:'Nome nuova famiglia…', add_family_btn:'+ Famiglia',
    join_placeholder:'Inserisci codice per unirti…', join_btn:'Unisciti',
    disasters_nav_btn:'🌋 Disastri Naturali',
    weather_nav_btn:'⛅ Meteo', checklist_nav_btn:'✅ Lista di Preparazione',
    back_menu:'← Torna al Menu', back_results:'← Risultati',
    checklist_title:'✅ Lista di Preparazione',
    checklist_subtitle:'Adattata ai tuoi rischi regionali · spunta gli elementi mentre prepari il tuo kit',
    overall_prep:'Preparazione Complessiva',
    weather_title:'⛅ Meteo Attuale', wind_speed:'Velocità del Vento', precipitation:'Precipitazioni', feels_like:'Percepita',
    share_btn:'🔗 Condividi', save_report_btn:'💾 Salva Report',
    no_events:'Nessun evento significativo rilevato in questa regione per il periodo selezionato.',
    weighted_event:'evento ponderato', weighted_events:'eventi ponderati',
    conf_high:'Alta affidabilità', conf_med:'Affidabilità media', conf_low:'Bassa affidabilità',
    universal_name:'Elementi Universali', universal_reason:'Applicabile a qualsiasi tipo di emergenza', reset_btn:'↺ Reimposta',
    risk_earthquake:'Terremoto', risk_wildfire:'Incendio Boschivo', risk_flood:'Alluvione', risk_volcano:'Vulcano',
    risk_storm:'Tempesta Severa', risk_drought:'Siccità', risk_tornado:'Tornado', risk_hurricane:'Uragano',
    risk_winter_storm:'Tempesta Invernale', risk_extreme_heat:'Caldo Estremo', risk_severe_weather:'Maltempo Severo',
    wmo_0:'Cielo Sereno', wmo_1:'Prevalentemente Sereno', wmo_2:'Parzialmente Nuvoloso', wmo_3:'Nuvoloso',
    wmo_fog:'Nebbia', wmo_drizzle:'Pioggerella', wmo_rain:'Pioggia', wmo_snow:'Neve',
    wmo_rain_showers:'Rovesci di Pioggia', wmo_snow_showers:'Rovesci di Neve', wmo_thunderstorm:'Temporale',
    ck_earthquake_reason:"Basato sull'attività sismica rilevata nella tua area",
    ck_wildfire_reason:'Incendi boschivi rilevati nella tua regione',
    ck_flood_reason:'Alluvioni rilevate vicino alla tua regione',
    ck_volcano_reason:'Attività vulcanica rilevata vicino alla tua regione',
    ck_winter_storm_reason:'Rischio di tempesta invernale o allerte rilevati',
    ck_hurricane_reason:'Rischio uragano o allerte rilevati',
    ck_tornado_reason:'Rischio tornado o allerte rilevati',
    ck_extreme_heat_reason:'Allerte per caldo estremo attive nella regione',
    ck_storm_reason:'Eventi di tempesta rilevati nella regione',
    ck_drought_reason:'Condizioni di siccità rilevate nella regione',
    ck_severe_weather_reason:'Rischio generale di maltempo severo per questa regione',
    lp_slogan:'La tua regione. I tuoi rischi. Il tuo piano.',
    lp_sub:'Dati sui disastri in tempo reale, analisi del rischio personalizzata e strumenti di preparazione — costruiti intorno alla tua posizione esatta, gratis.',
    lp_cta_start:'Inizia →', lp_no_bs:'Nessun account richiesto · Gratuito per sempre',
    lp_source_label:'Dati in diretta da', lp_section_tag:'Perché sceglierci',
    lp_section_title:'Non la solita app generica per le emergenze',
    lp_section_sub:'La maggior parte delle app mostra notizie nazionali. Noi analizziamo cosa sta accadendo entro 400 km dal tuo indirizzo esatto.',
    lp_panel1_title:'Dati sui Disastri in Diretta',
    lp_panel1_desc:"Recupera dati sui terremoti dall'USGS, eventi naturali dalla NASA EONET e allerte meteo attive dall'NWS in tempo reale — ad ogni ricerca.",
    lp_panel2_title:'Analisi del Rischio Iperlocale',
    lp_panel2_desc:'Gli eventi in un raggio di 400 km intorno alle tue coordinate esatte vengono classificati per frequenza e gravità ponderata — non per medie nazionali.',
    lp_panel3_title:'Liste di Controllo Personalizzate',
    lp_panel3_desc:'La tua lista di preparazione è costruita dal tuo profilo di rischio regionale. Zona sismica? Ricevi elementi per i terremoti. Area a rischio incendi? Stessa idea.',
    lp_panel4_title:'Educazione sui Disastri',
    lp_panel4_desc:"Guide dettagliate per 12 tipi di disastri naturali — cause, segnali d'allerta, cosa fare durante e dopo — supportate da fonti ufficiali.",
    lp_panel5_title:'Meteo e Allerte Attive',
    lp_panel5_desc:'Condizioni attuali e allerte di emergenza NWS in diretta per la tua area, più una mappa interattiva per visualizzare gli eventi storici nel tempo.',
    lp_panel6_title:'Tracker Familiare',
    lp_panel6_desc:'Crea gruppi familiari, tieni traccia dei progressi di preparazione di ogni membro e sincronizza in tempo reale tra dispositivi — senza registrazione.',
    lp_bottom_title:'Pronto a vedere cosa sta succedendo nella tua regione?',
    lp_bottom_sub:'Inserisci semplicemente la tua città. Richiede meno di 10 secondi.',
    lp_bottom_cta:'Controlla La Mia Regione →', scroll_hint:'Scorri per vedere altro', home_btn:'🏠 Home',
  },
  ru: {
    lang_name:'RU', header_subtitle:'Мониторинг стихийных бедствий в реальном времени и список готовности',
    search_label:'Поиск вашего региона', search_placeholder:'Город, регион или индекс…',
    search_btn:'Поиск', geo_btn:'📍 Использовать моё местоположение',
    empty_title:'Найдите свой регион, чтобы начать',
    empty_msg:'Введите город или используйте своё местоположение для просмотра последних событий,<br>анализа рисков и персонализированного контрольного списка.',
    loading_title:'Загрузка региональных данных…',
    loading_msg:'Запрос землетрясений USGS, событий NASA EONET<br>и предупреждений NWS',
    map_title:'🗺️ Карта событий', time_machine:'⏱ Машина времени', all_time:'Всё время',
    play:'▶ Воспроизвести', pause:'⏸ Пауза',
    stat_quakes:'Землетрясения', stat_fires:'Пожары', stat_floods:'Наводнения', stat_alerts:'Предупреждения',
    risks_title:'⚠️ Главные региональные риски',
    day_btn:'День', week_btn:'Неделя', month_btn:'Месяц', yr_unit:'лет',
    tracker_title:'👨‍👩‍👧 Трекер домохозяйства',
    family_placeholder:'Название новой семьи…', add_family_btn:'+ Семья',
    join_placeholder:'Введите код для присоединения…', join_btn:'Присоединиться',
    disasters_nav_btn:'🌋 Стихийные бедствия',
    weather_nav_btn:'⛅ Погода', checklist_nav_btn:'✅ Контрольный список',
    back_menu:'← Назад в меню', back_results:'← Результаты',
    checklist_title:'✅ Контрольный список готовности',
    checklist_subtitle:'Адаптирован к вашим рискам · отмечайте пункты при подготовке',
    overall_prep:'Общая готовность',
    weather_title:'⛅ Текущая погода', wind_speed:'Скорость ветра', precipitation:'Осадки', feels_like:'Ощущается как',
    share_btn:'🔗 Поделиться', save_report_btn:'💾 Сохранить отчёт',
    no_events:'Для выбранного периода в этом регионе значимых событий не обнаружено.',
    weighted_event:'взвешенное событие', weighted_events:'взвешенных событий',
    conf_high:'Высокая достоверность', conf_med:'Средняя достоверность', conf_low:'Низкая достоверность',
    universal_name:'Универсальные необходимые вещи', universal_reason:'Применимо к любой чрезвычайной ситуации', reset_btn:'↺ Сбросить',
    risk_earthquake:'Землетрясение', risk_wildfire:'Лесной пожар', risk_flood:'Наводнение', risk_volcano:'Вулкан',
    risk_storm:'Сильный шторм', risk_drought:'Засуха', risk_tornado:'Торнадо', risk_hurricane:'Ураган',
    risk_winter_storm:'Зимняя буря', risk_extreme_heat:'Экстремальная жара', risk_severe_weather:'Опасные метеоявления',
    wmo_0:'Ясное небо', wmo_1:'Преимущественно ясно', wmo_2:'Переменная облачность', wmo_3:'Пасмурно',
    wmo_fog:'Туман', wmo_drizzle:'Морось', wmo_rain:'Дождь', wmo_snow:'Снег',
    wmo_rain_showers:'Ливень', wmo_snow_showers:'Снегопад', wmo_thunderstorm:'Гроза',
    ck_earthquake_reason:'На основе сейсмической активности в вашем регионе',
    ck_wildfire_reason:'В вашем регионе обнаружены лесные пожары',
    ck_flood_reason:'Вблизи вашего региона обнаружены наводнения',
    ck_volcano_reason:'Вблизи вашего региона обнаружена вулканическая активность',
    ck_winter_storm_reason:'Обнаружен риск зимней бури или предупреждения',
    ck_hurricane_reason:'Обнаружен риск урагана или предупреждения',
    ck_tornado_reason:'Обнаружен риск торнадо или предупреждения',
    ck_extreme_heat_reason:'В регионе действуют предупреждения об экстремальной жаре',
    ck_storm_reason:'В регионе обнаружены штормовые явления',
    ck_drought_reason:'В регионе обнаружены условия засухи',
    ck_severe_weather_reason:'Общий риск опасных метеоявлений для данного региона',
    lp_slogan:'Ваш регион. Ваши риски. Ваш план.',
    lp_sub:'Данные о стихийных бедствиях в реальном времени, персонализированный анализ рисков и инструменты подготовки — созданные для вашего местоположения, бесплатно.',
    lp_cta_start:'Начать →', lp_no_bs:'Регистрация не нужна · Всегда бесплатно',
    lp_source_label:'Данные в реальном времени от', lp_section_tag:'Почему мы',
    lp_section_title:'Не ещё одно типичное приложение о чрезвычайных ситуациях',
    lp_section_sub:'Большинство приложений показывают национальные новости. Мы анализируем, что происходит в радиусе 400 км от вашего адреса.',
    lp_panel1_title:'Данные о бедствиях в реальном времени',
    lp_panel1_desc:'Получает данные о землетрясениях из USGS, природных событиях из NASA EONET и предупреждениях из NWS в реальном времени — при каждом поиске.',
    lp_panel2_title:'Гиперлокальный анализ рисков',
    lp_panel2_desc:'События в радиусе 400 км от ваших координат ранжируются по частоте и взвешенной серьёзности — а не по национальным средним показателям.',
    lp_panel3_title:'Персональные контрольные списки',
    lp_panel3_desc:'Список готовности формируется на основе вашего регионального профиля рисков. Сейсмическая зона? Получите пункты для землетрясений. Зона пожаров? Аналогично.',
    lp_panel4_title:'Знания о катастрофах',
    lp_panel4_desc:'Подробные руководства по 12 типам стихийных бедствий — причины, предупредительные знаки, что делать во время и после — на основе официальных источников.',
    lp_panel5_title:'Погода и активные предупреждения',
    lp_panel5_desc:'Текущая погода и экстренные предупреждения NWS в реальном времени, плюс интерактивная карта исторических катастроф.',
    lp_panel6_title:'Трекер домохозяйства',
    lp_panel6_desc:'Создавайте семейные группы, отслеживайте готовность каждого члена и синхронизируйте между устройствами — без регистрации.',
    lp_bottom_title:'Готовы узнать, что происходит в вашем регионе?',
    lp_bottom_sub:'Просто введите свой город. Займёт меньше 10 секунд.',
    lp_bottom_cta:'Проверить мой регион →', scroll_hint:'Прокрутите вниз', home_btn:'🏠 Главная',
  },
  hi: {
    lang_name:'HI', header_subtitle:'रियल-टाइम आपदा जागरूकता और तैयारी सूची',
    search_label:'अपना क्षेत्र खोजें', search_placeholder:'शहर, राज्य, या पिन कोड…',
    search_btn:'खोजें', geo_btn:'📍 मेरी लोकेशन उपयोग करें',
    empty_title:'शुरू करने के लिए अपना क्षेत्र खोजें',
    empty_msg:'हाल की आपदाओं, जोखिम विश्लेषण और व्यक्तिगत तैयारी सूची देखने के लिए<br>कोई शहर दर्ज करें या अपनी लोकेशन उपयोग करें।',
    loading_title:'क्षेत्रीय डेटा प्राप्त हो रहा है…',
    loading_msg:'USGS भूकंप, NASA EONET प्राकृतिक घटनाएं<br>और NWS मौसम अलर्ट खोजे जा रहे हैं',
    map_title:'🗺️ घटना मानचित्र', time_machine:'⏱ टाइम मशीन', all_time:'सभी समय',
    play:'▶ चलाएं', pause:'⏸ रोकें',
    stat_quakes:'भूकंप', stat_fires:'जंगली आग', stat_floods:'बाढ़', stat_alerts:'अलर्ट',
    risks_title:'⚠️ शीर्ष क्षेत्रीय जोखिम',
    day_btn:'दिन', week_btn:'सप्ताह', month_btn:'महीना', yr_unit:'वर्ष',
    tracker_title:'👨‍👩‍👧 परिवार ट्रैकर',
    family_placeholder:'नए परिवार का नाम…', add_family_btn:'+ परिवार',
    join_placeholder:'परिवार जॉइन करने के लिए कोड दर्ज करें…', join_btn:'जॉइन करें',
    disasters_nav_btn:'🌋 प्राकृतिक आपदाएं',
    weather_nav_btn:'⛅ मौसम', checklist_nav_btn:'✅ तैयारी सूची',
    back_menu:'← मेनू पर वापस', back_results:'← परिणाम',
    checklist_title:'✅ तैयारी सूची',
    checklist_subtitle:'आपके क्षेत्रीय जोखिमों के अनुरूप · अपनी किट बनाते समय आइटम चेक करें',
    overall_prep:'समग्र तैयारी',
    weather_title:'⛅ वर्तमान मौसम', wind_speed:'हवा की गति', precipitation:'वर्षा', feels_like:'महसूस होता है',
    share_btn:'🔗 साझा करें', save_report_btn:'💾 रिपोर्ट सहेजें',
    no_events:'चुनी गई अवधि के लिए इस क्षेत्र में कोई महत्वपूर्ण घटना नहीं मिली।',
    weighted_event:'भारित घटना', weighted_events:'भारित घटनाएं',
    conf_high:'उच्च विश्वास', conf_med:'मध्यम विश्वास', conf_low:'कम विश्वास',
    universal_name:'सार्वभौमिक आवश्यकताएं', universal_reason:'सभी प्रकार की आपात स्थितियों पर लागू', reset_btn:'↺ रीसेट',
    risk_earthquake:'भूकंप', risk_wildfire:'जंगली आग', risk_flood:'बाढ़', risk_volcano:'ज्वालामुखी',
    risk_storm:'तीव्र तूफान', risk_drought:'सूखा', risk_tornado:'बवंडर', risk_hurricane:'चक्रवात',
    risk_winter_storm:'शीतकालीन तूफान', risk_extreme_heat:'अत्यधिक गर्मी', risk_severe_weather:'गंभीर मौसम',
    wmo_0:'साफ आसमान', wmo_1:'अधिकतर साफ', wmo_2:'आंशिक रूप से बादल', wmo_3:'बादल',
    wmo_fog:'कोहरा', wmo_drizzle:'बूंदाबांदी', wmo_rain:'बारिश', wmo_snow:'बर्फ',
    wmo_rain_showers:'बारिश की फुहारें', wmo_snow_showers:'बर्फ की फुहारें', wmo_thunderstorm:'आंधी-तूफान',
    ck_earthquake_reason:'आपके क्षेत्र में पता लगाई गई भूकंपीय गतिविधि के आधार पर',
    ck_wildfire_reason:'आपके क्षेत्र में जंगली आग की घटनाएं पता लगाई गईं',
    ck_flood_reason:'आपके क्षेत्र के पास बाढ़ की घटनाएं पता लगाई गईं',
    ck_volcano_reason:'आपके क्षेत्र के पास ज्वालामुखी गतिविधि पता लगाई गई',
    ck_winter_storm_reason:'शीतकालीन तूफान जोखिम या अलर्ट पता लगाए गए',
    ck_hurricane_reason:'चक्रवात जोखिम या अलर्ट पता लगाए गए',
    ck_tornado_reason:'बवंडर जोखिम या अलर्ट पता लगाए गए',
    ck_extreme_heat_reason:'क्षेत्र में अत्यधिक गर्मी के अलर्ट सक्रिय',
    ck_storm_reason:'क्षेत्र में तूफान की घटनाएं पता लगाई गईं',
    ck_drought_reason:'क्षेत्र में सूखे की स्थिति पता लगाई गई',
    ck_severe_weather_reason:'इस क्षेत्र के लिए सामान्य गंभीर मौसम जोखिम',
    lp_slogan:'आपका क्षेत्र। आपके जोखिम। आपकी योजना।',
    lp_sub:'रियल-टाइम आपदा डेटा, व्यक्तिगत जोखिम विश्लेषण और तैयारी के उपकरण — आपकी सटीक लोकेशन के अनुसार, मुफ्त में।',
    lp_cta_start:'शुरू करें →', lp_no_bs:'कोई अकाउंट आवश्यक नहीं · हमेशा मुफ्त',
    lp_source_label:'लाइव डेटा स्रोत', lp_section_tag:'हमें क्यों चुनें',
    lp_section_title:'एक और सामान्य आपातकालीन ऐप नहीं',
    lp_section_sub:'अधिकांश ऐप राष्ट्रीय सुर्खियां दिखाते हैं। हम आपके सटीक पते से 400 किमी के दायरे में क्या हो रहा है, यह विश्लेषण करते हैं।',
    lp_panel1_title:'लाइव आपदा डेटा',
    lp_panel1_desc:'USGS से भूकंप डेटा, NASA EONET से प्राकृतिक घटनाएं और NWS से सक्रिय मौसम अलर्ट रियल-टाइम में प्राप्त करता है — हर बार जब आप खोजते हैं।',
    lp_panel2_title:'हाइपर-लोकल जोखिम विश्लेषण',
    lp_panel2_desc:'आपके सटीक निर्देशांक के 400 किमी दायरे में घटनाओं को आवृत्ति और भारित गंभीरता के आधार पर रैंक किया जाता है — राष्ट्रीय औसत से नहीं।',
    lp_panel3_title:'व्यक्तिगत चेकलिस्ट',
    lp_panel3_desc:'आपकी तैयारी चेकलिस्ट आपके क्षेत्रीय जोखिम प्रोफ़ाइल से बनाई जाती है। भूकंप क्षेत्र? भूकंप आइटम मिलते हैं। जंगली आग क्षेत्र? वही विचार।',
    lp_panel4_title:'आपदा शिक्षा',
    lp_panel4_desc:'12 प्रकार की प्राकृतिक आपदाओं के लिए विस्तृत गाइड — कारण, चेतावनी के संकेत, दौरान और बाद में क्या करें — आधिकारिक स्रोतों द्वारा समर्थित।',
    lp_panel5_title:'मौसम और सक्रिय अलर्ट',
    lp_panel5_desc:'आपके क्षेत्र के लिए वर्तमान मौसम और लाइव NWS आपातकालीन अलर्ट, साथ ही ऐतिहासिक आपदाओं को देखने के लिए इंटरैक्टिव मानचित्र।',
    lp_panel6_title:'परिवार ट्रैकर',
    lp_panel6_desc:'परिवार समूह बनाएं, प्रत्येक सदस्य की तैयारी प्रगति ट्रैक करें, और डिवाइस के पार रियल-टाइम में सिंक करें — पंजीकरण की आवश्यकता नहीं।',
    lp_bottom_title:'अपने क्षेत्र में क्या हो रहा है, देखने के लिए तैयार हैं?',
    lp_bottom_sub:'बस अपना शहर दर्ज करें। 10 सेकंड से कम लगता है।',
    lp_bottom_cta:'मेरा क्षेत्र देखें →', scroll_hint:'और देखने के लिए स्क्रॉल करें', home_btn:'🏠 होम',
  },
  ja: {
    lang_name:'JA', header_subtitle:'リアルタイム災害情報と防災チェックリスト',
    search_label:'地域を検索', search_placeholder:'市区町村、都道府県、または郵便番号…',
    search_btn:'検索', geo_btn:'📍 現在地を使用',
    empty_title:'地域を検索して始めましょう',
    empty_msg:'市区町村を入力するか、現在地を使用して最近の災害情報、<br>リスク分析、個人向け防災チェックリストを確認しましょう。',
    loading_title:'地域データを取得中…',
    loading_msg:'USGS地震データ、NASA EONET自然災害情報、<br>NWS気象警報を照会中',
    map_title:'🗺️ イベントマップ', time_machine:'⏱ タイムマシン', all_time:'全期間',
    play:'▶ 再生', pause:'⏸ 停止',
    stat_quakes:'地震', stat_fires:'山火事', stat_floods:'洪水', stat_alerts:'警報',
    risks_title:'⚠️ 主要な地域リスク',
    day_btn:'日', week_btn:'週', month_btn:'月', yr_unit:'年',
    tracker_title:'👨‍👩‍👧 世帯トラッカー',
    family_placeholder:'新しい家族グループ名…', add_family_btn:'+ 家族',
    join_placeholder:'参加コードを入力…', join_btn:'参加',
    disasters_nav_btn:'🌋 自然災害',
    weather_nav_btn:'⛅ 天気', checklist_nav_btn:'✅ 防災チェックリスト',
    back_menu:'← メニューに戻る', back_results:'← 結果に戻る',
    checklist_title:'✅ 防災チェックリスト',
    checklist_subtitle:'地域リスクに合わせたリスト · 準備が整ったらチェックしましょう',
    overall_prep:'総合的な備え',
    weather_title:'⛅ 現在の天気', wind_speed:'風速', precipitation:'降水量', feels_like:'体感温度',
    share_btn:'🔗 シェア', save_report_btn:'💾 レポートを保存',
    no_events:'選択した期間内に、この地域で重大な出来事は検出されませんでした。',
    weighted_event:'加重イベント', weighted_events:'加重イベント',
    conf_high:'高信頼度', conf_med:'中信頼度', conf_low:'低信頼度',
    universal_name:'共通必需品', universal_reason:'あらゆる緊急事態に対応', reset_btn:'↺ リセット',
    risk_earthquake:'地震', risk_wildfire:'山火事', risk_flood:'洪水', risk_volcano:'火山',
    risk_storm:'暴風雨', risk_drought:'干ばつ', risk_tornado:'竜巻', risk_hurricane:'ハリケーン',
    risk_winter_storm:'冬の嵐', risk_extreme_heat:'猛暑', risk_severe_weather:'悪天候',
    wmo_0:'快晴', wmo_1:'ほぼ晴れ', wmo_2:'一部曇り', wmo_3:'曇り',
    wmo_fog:'霧', wmo_drizzle:'霧雨', wmo_rain:'雨', wmo_snow:'雪',
    wmo_rain_showers:'にわか雨', wmo_snow_showers:'にわか雪', wmo_thunderstorm:'雷雨',
    ck_earthquake_reason:'地域で検出された地震活動に基づく',
    ck_wildfire_reason:'地域で山火事が検出されました',
    ck_flood_reason:'近隣で洪水が検出されました',
    ck_volcano_reason:'近隣で火山活動が検出されました',
    ck_winter_storm_reason:'冬の嵐のリスクまたは警報が検出されました',
    ck_hurricane_reason:'ハリケーンのリスクまたは警報が検出されました',
    ck_tornado_reason:'竜巻のリスクまたは警報が検出されました',
    ck_extreme_heat_reason:'地域で猛暑警報が発令中',
    ck_storm_reason:'地域で嵐が検出されました',
    ck_drought_reason:'地域で干ばつが検出されました',
    ck_severe_weather_reason:'この地域の全般的な悪天候リスク',
    lp_slogan:'あなたの地域。あなたのリスク。あなたの計画。',
    lp_sub:'リアルタイム災害データ、個人向けリスク分析、防災ツール — あなたの正確な場所に合わせて、無料でご提供。',
    lp_cta_start:'始める →', lp_no_bs:'アカウント不要 · 完全無料',
    lp_source_label:'ライブデータ提供', lp_section_tag:'なぜ選ばれるのか',
    lp_section_title:'ありきたりな防災アプリではありません',
    lp_section_sub:'ほとんどのアプリは全国のニュースを表示します。私たちはあなたの正確な住所から400km圏内で何が起きているかを分析します。',
    lp_panel1_title:'リアルタイム災害データ',
    lp_panel1_desc:'USGSから地震データ、NASA EONETから自然災害情報、NWSから気象警報をリアルタイムで取得 — 検索のたびに。',
    lp_panel2_title:'超ローカルなリスク分析',
    lp_panel2_desc:'あなたの正確な座標から400km圏内の出来事を、頻度と重み付けされた深刻度でランク付け — 全国平均ではなく。',
    lp_panel3_title:'個人向けチェックリスト',
    lp_panel3_desc:'地域のリスクプロフィールに基づいた防災チェックリストを作成。地震エリア？地震対応アイテムを提供。山火事エリア？同じ考え方。',
    lp_panel4_title:'災害教育',
    lp_panel4_desc:'12種類の自然災害に関する詳細ガイド — 原因、警戒サイン、発生中・発生後の対処法 — 公式情報源に基づく。',
    lp_panel5_title:'天気と気象警報',
    lp_panel5_desc:'あなたの地域の現在の気象状況とNWS緊急警報、さらに過去の災害を時系列で確認できるインタラクティブマップ。',
    lp_panel6_title:'世帯トラッカー',
    lp_panel6_desc:'家族グループを作成し、各メンバーの備え状況を追跡。デバイス間でリアルタイムに同期 — 登録不要。',
    lp_bottom_title:'あなたの地域で何が起きているか確認しましょう',
    lp_bottom_sub:'市区町村を入力するだけ。10秒以内に結果が出ます。',
    lp_bottom_cta:'マイリージョンを確認 →', scroll_hint:'スクロールして続きを見る', home_btn:'🏠 ホーム',
  },
  ar: {
    lang_name:'AR', header_subtitle:'رصد الكوارث في الوقت الفعلي وقائمة التأهب',
    search_label:'ابحث عن منطقتك', search_placeholder:'مدينة، ولاية، أو رمز بريدي…',
    search_btn:'بحث', geo_btn:'📍 استخدام موقعي',
    empty_title:'ابحث عن منطقتك للبدء',
    empty_msg:'أدخل مدينة أو استخدم موقعك لعرض الأحداث الأخيرة<br>وتحليل المخاطر وقائمة التأهب الشخصية.',
    loading_title:'جارٍ جلب البيانات الإقليمية…',
    loading_msg:'الاستعلام عن زلازل USGS وأحداث NASA EONET<br>وتحذيرات الطقس NWS',
    map_title:'🗺️ خريطة الأحداث', time_machine:'⏱ آلة الزمن', all_time:'كل الأوقات',
    play:'▶ تشغيل', pause:'⏸ إيقاف مؤقت',
    stat_quakes:'الزلازل', stat_fires:'الحرائق', stat_floods:'الفيضانات', stat_alerts:'التحذيرات',
    risks_title:'⚠️ أبرز المخاطر الإقليمية',
    day_btn:'يوم', week_btn:'أسبوع', month_btn:'شهر', yr_unit:'سنة',
    tracker_title:'👨‍👩‍👧 متتبع الأسرة',
    family_placeholder:'اسم المجموعة الجديدة…', add_family_btn:'+ أسرة',
    join_placeholder:'أدخل الرمز للانضمام…', join_btn:'انضمام',
    disasters_nav_btn:'🌋 الكوارث الطبيعية',
    weather_nav_btn:'⛅ الطقس', checklist_nav_btn:'✅ قائمة التأهب',
    back_menu:'← العودة إلى القائمة', back_results:'← النتائج',
    checklist_title:'✅ قائمة التأهب',
    checklist_subtitle:'مُعدَّلة وفق مخاطرك الإقليمية · ضع علامة على العناصر أثناء إعداد حقيبتك',
    overall_prep:'الاستعداد العام',
    weather_title:'⛅ الطقس الحالي', wind_speed:'سرعة الرياح', precipitation:'هطول الأمطار', feels_like:'تشعر كأنه',
    share_btn:'🔗 مشاركة', save_report_btn:'💾 حفظ التقرير',
    no_events:'لم يُرصد أي حدث مهم في هذه المنطقة خلال الفترة المحددة.',
    weighted_event:'حدث مرجَّح', weighted_events:'أحداث مرجَّحة',
    conf_high:'ثقة عالية', conf_med:'ثقة متوسطة', conf_low:'ثقة منخفضة',
    universal_name:'الضروريات العامة', universal_reason:'ينطبق على جميع أنواع حالات الطوارئ', reset_btn:'↺ إعادة تعيين',
    risk_earthquake:'زلزال', risk_wildfire:'حريق غابات', risk_flood:'فيضان', risk_volcano:'بركان',
    risk_storm:'عاصفة شديدة', risk_drought:'جفاف', risk_tornado:'إعصار', risk_hurricane:'إعصار مداري',
    risk_winter_storm:'عاصفة شتوية', risk_extreme_heat:'حر شديد', risk_severe_weather:'طقس عاصف',
    wmo_0:'سماء صافية', wmo_1:'غالباً صافية', wmo_2:'غيوم جزئية', wmo_3:'غائم',
    wmo_fog:'ضباب', wmo_drizzle:'رذاذ', wmo_rain:'مطر', wmo_snow:'ثلج',
    wmo_rain_showers:'زخات مطر', wmo_snow_showers:'زخات ثلج', wmo_thunderstorm:'عاصفة رعدية',
    ck_earthquake_reason:'بناءً على النشاط الزلزالي المرصود في منطقتك',
    ck_wildfire_reason:'رُصدت حرائق غابات في منطقتك',
    ck_flood_reason:'رُصدت فيضانات قرب منطقتك',
    ck_volcano_reason:'رُصد نشاط بركاني قرب منطقتك',
    ck_winter_storm_reason:'رُصد خطر عاصفة شتوية أو تحذيرات',
    ck_hurricane_reason:'رُصد خطر إعصار مداري أو تحذيرات',
    ck_tornado_reason:'رُصد خطر إعصار أو تحذيرات',
    ck_extreme_heat_reason:'تحذيرات الحر الشديد نشطة في المنطقة',
    ck_storm_reason:'رُصدت أحداث عاصفة في المنطقة',
    ck_drought_reason:'رُصدت ظروف جفاف في المنطقة',
    ck_severe_weather_reason:'خطر عام من طقس عاصف في هذه المنطقة',
    lp_slogan:'منطقتك. مخاطرك. خطتك.',
    lp_sub:'بيانات الكوارث في الوقت الفعلي، وتحليل المخاطر الشخصي، وأدوات التأهب — مُصمَّمة لموقعك تحديداً، مجاناً.',
    lp_cta_start:'ابدأ الآن ←', lp_no_bs:'لا حساب مطلوب · مجاني للأبد',
    lp_source_label:'بيانات مباشرة من', lp_section_tag:'لماذا نحن',
    lp_section_title:'ليس تطبيق طوارئ عاماً آخر',
    lp_section_sub:'معظم التطبيقات تعرض عناوين وطنية. نحن نحلل ما يحدث في نطاق 400 كم من عنوانك الدقيق.',
    lp_panel1_title:'بيانات الكوارث المباشرة',
    lp_panel1_desc:'يجلب بيانات الزلازل من USGS والأحداث الطبيعية من NASA EONET وتحذيرات الطقس من NWS في الوقت الفعلي مع كل بحث.',
    lp_panel2_title:'تحليل المخاطر الفائق المحلية',
    lp_panel2_desc:'تُرتَّب الأحداث في نطاق 400 كم من إحداثياتك الدقيقة حسب التكرار والخطورة المرجَّحة لا المتوسطات الوطنية.',
    lp_panel3_title:'قوائم مخصصة',
    lp_panel3_desc:'قائمة التأهب مبنية على ملف مخاطرك الإقليمي. منطقة زلزالية؟ ستحصل على بنود الزلازل. منطقة حرائق؟ نفس الفكرة.',
    lp_panel4_title:'التثقيف بالكوارث',
    lp_panel4_desc:'أدلة مفصَّلة لـ12 نوعاً من الكوارث الطبيعية — الأسباب وعلامات التحذير وما يجب فعله خلال الحدث وبعده من مصادر رسمية.',
    lp_panel5_title:'الطقس والتنبيهات النشطة',
    lp_panel5_desc:'الأحوال الجوية الحالية وتنبيهات NWS المباشرة لمنطقتك إضافةً إلى خريطة تفاعلية لعرض الكوارث التاريخية عبر الزمن.',
    lp_panel6_title:'متتبع الأسرة',
    lp_panel6_desc:'أنشئ مجموعات عائلية وتابع تقدم التأهب لكل فرد وزامن بين الأجهزة في الوقت الفعلي دون تسجيل.',
    lp_bottom_title:'هل أنت مستعد لمعرفة ما يحدث في منطقتك؟',
    lp_bottom_sub:'فقط أدخل مدينتك. يستغرق أقل من 10 ثوانٍ.',
    lp_bottom_cta:'عرض منطقتي ←', scroll_hint:'مرِّر للمزيد', home_btn:'🏠 الرئيسية',
  },
  bn: {
    lang_name:'BN', header_subtitle:'রিয়েল-টাইম দুর্যোগ পর্যবেক্ষণ এবং প্রস্তুতি তালিকা',
    search_label:'আপনার অঞ্চল অনুসন্ধান করুন', search_placeholder:'শহর, জেলা, বা পিন কোড…',
    search_btn:'অনুসন্ধান', geo_btn:'📍 আমার অবস্থান ব্যবহার করুন',
    empty_title:'শুরু করতে আপনার অঞ্চল অনুসন্ধান করুন',
    empty_msg:'সাম্প্রতিক দুর্যোগ, ঝুঁকি বিশ্লেষণ এবং ব্যক্তিগত প্রস্তুতি তালিকা দেখতে<br>একটি শহর লিখুন বা আপনার অবস্থান ব্যবহার করুন।',
    loading_title:'আঞ্চলিক তথ্য লোড হচ্ছে…',
    loading_msg:'USGS ভূমিকম্প, NASA EONET প্রাকৃতিক ঘটনা<br>এবং NWS আবহাওয়া সতর্কতা অনুসন্ধান করা হচ্ছে',
    map_title:'🗺️ ঘটনার মানচিত্র', time_machine:'⏱ সময় যন্ত্র', all_time:'সব সময়',
    play:'▶ চালান', pause:'⏸ বিরতি',
    stat_quakes:'ভূমিকম্প', stat_fires:'দাবানল', stat_floods:'বন্যা', stat_alerts:'সতর্কতা',
    risks_title:'⚠️ শীর্ষ আঞ্চলিক ঝুঁকি',
    day_btn:'দিন', week_btn:'সপ্তাহ', month_btn:'মাস', yr_unit:'বছর',
    tracker_title:'👨‍👩‍👧 পরিবার ট্র্যাকার',
    family_placeholder:'নতুন পরিবারের নাম…', add_family_btn:'+ পরিবার',
    join_placeholder:'যোগ দিতে কোড লিখুন…', join_btn:'যোগ দিন',
    disasters_nav_btn:'🌋 প্রাকৃতিক দুর্যোগ',
    weather_nav_btn:'⛅ আবহাওয়া', checklist_nav_btn:'✅ প্রস্তুতি তালিকা',
    back_menu:'← মেনুতে ফিরুন', back_results:'← ফলাফল',
    checklist_title:'✅ প্রস্তুতি তালিকা',
    checklist_subtitle:'আপনার আঞ্চলিক ঝুঁকি অনুযায়ী · কিট তৈরি করার সময় আইটেম চেক করুন',
    overall_prep:'সামগ্রিক প্রস্তুতি',
    weather_title:'⛅ বর্তমান আবহাওয়া', wind_speed:'বায়ুর গতি', precipitation:'বৃষ্টিপাত', feels_like:'অনুভব হচ্ছে',
    share_btn:'🔗 শেয়ার করুন', save_report_btn:'💾 রিপোর্ট সংরক্ষণ করুন',
    no_events:'নির্বাচিত সময়ের জন্য এই অঞ্চলে কোনো উল্লেখযোগ্য ঘটনা পাওয়া যায়নি।',
    weighted_event:'ভারিত ঘটনা', weighted_events:'ভারিত ঘটনাসমূহ',
    conf_high:'উচ্চ আস্থা', conf_med:'মধ্যম আস্থা', conf_low:'নিম্ন আস্থা',
    universal_name:'সার্বজনীন প্রয়োজনীয়', universal_reason:'সব ধরনের জরুরি পরিস্থিতিতে প্রযোজ্য', reset_btn:'↺ রিসেট',
    risk_earthquake:'ভূমিকম্প', risk_wildfire:'দাবানল', risk_flood:'বন্যা', risk_volcano:'আগ্নেয়গিরি',
    risk_storm:'তীব্র ঝড়', risk_drought:'খরা', risk_tornado:'টর্নেডো', risk_hurricane:'হারিকেন',
    risk_winter_storm:'শীতকালীন ঝড়', risk_extreme_heat:'অতিরিক্ত গরম', risk_severe_weather:'তীব্র আবহাওয়া',
    wmo_0:'পরিষ্কার আকাশ', wmo_1:'প্রধানত পরিষ্কার', wmo_2:'আংশিক মেঘলা', wmo_3:'মেঘলা',
    wmo_fog:'কুয়াশা', wmo_drizzle:'গুঁড়ি বৃষ্টি', wmo_rain:'বৃষ্টি', wmo_snow:'তুষার',
    wmo_rain_showers:'বৃষ্টির ঝাপটা', wmo_snow_showers:'তুষারপাত', wmo_thunderstorm:'বজ্রঝড়',
    ck_earthquake_reason:'আপনার এলাকায় সনাক্ত হওয়া ভূমিকম্পের কার্যক্রমের উপর ভিত্তি করে',
    ck_wildfire_reason:'আপনার অঞ্চলে দাবানল সনাক্ত হয়েছে',
    ck_flood_reason:'আপনার অঞ্চলের কাছে বন্যা সনাক্ত হয়েছে',
    ck_volcano_reason:'আপনার অঞ্চলের কাছে আগ্নেয়গিরির কার্যক্রম সনাক্ত হয়েছে',
    ck_winter_storm_reason:'শীতকালীন ঝড়ের ঝুঁকি বা সতর্কতা সনাক্ত হয়েছে',
    ck_hurricane_reason:'হারিকেনের ঝুঁকি বা সতর্কতা সনাক্ত হয়েছে',
    ck_tornado_reason:'টর্নেডোর ঝুঁকি বা সতর্কতা সনাক্ত হয়েছে',
    ck_extreme_heat_reason:'অঞ্চলে অতিরিক্ত গরমের সতর্কতা সক্রিয়',
    ck_storm_reason:'অঞ্চলে ঝড়ের ঘটনা সনাক্ত হয়েছে',
    ck_drought_reason:'অঞ্চলে খরার পরিস্থিতি সনাক্ত হয়েছে',
    ck_severe_weather_reason:'এই অঞ্চলের জন্য সাধারণ তীব্র আবহাওয়ার ঝুঁকি',
    lp_slogan:'আপনার অঞ্চল। আপনার ঝুঁকি। আপনার পরিকল্পনা।',
    lp_sub:'রিয়েল-টাইম দুর্যোগ তথ্য, ব্যক্তিগত ঝুঁকি বিশ্লেষণ এবং প্রস্তুতি সরঞ্জাম — আপনার সঠিক অবস্থান অনুযায়ী, বিনামূল্যে।',
    lp_cta_start:'শুরু করুন →', lp_no_bs:'কোনো অ্যাকাউন্ট প্রয়োজন নেই · সবসময় বিনামূল্যে',
    lp_source_label:'লাইভ ডেটা উৎস', lp_section_tag:'কেন আমাদের বেছে নেবেন',
    lp_section_title:'আরেকটি সাধারণ জরুরি অ্যাপ নয়',
    lp_section_sub:'বেশিরভাগ অ্যাপ জাতীয় শিরোনাম দেখায়। আমরা আপনার সঠিক ঠিকানা থেকে ৪০০ কিমি ব্যাসার্ধের মধ্যে কী ঘটছে তা বিশ্লেষণ করি।',
    lp_panel1_title:'লাইভ দুর্যোগ তথ্য',
    lp_panel1_desc:'USGS থেকে ভূমিকম্প, NASA EONET থেকে প্রাকৃতিক ঘটনা এবং NWS থেকে সক্রিয় আবহাওয়া সতর্কতা রিয়েল-টাইমে সংগ্রহ করে।',
    lp_panel2_title:'হাইপার-লোকাল ঝুঁকি বিশ্লেষণ',
    lp_panel2_desc:'আপনার সঠিক স্থানাঙ্ক থেকে ৪০০ কিমির মধ্যে ঘটনাগুলো ফ্রিকোয়েন্সি ও ভারিত গুরুত্ব অনুযায়ী র‍্যাঙ্ক করা হয়।',
    lp_panel3_title:'ব্যক্তিগত চেকলিস্ট',
    lp_panel3_desc:'আপনার প্রস্তুতি তালিকা আপনার আঞ্চলিক ঝুঁকি প্রোফাইল থেকে তৈরি। ভূমিকম্প এলাকা? ভূমিকম্পের আইটেম পাবেন। দাবানল এলাকা? একই ধারণা।',
    lp_panel4_title:'দুর্যোগ শিক্ষা',
    lp_panel4_desc:'১২ ধরনের প্রাকৃতিক দুর্যোগের বিস্তারিত গাইড — কারণ, সতর্কসংকেত, দুর্যোগ চলাকালীন ও পরবর্তী করণীয় — সরকারি উৎস থেকে।',
    lp_panel5_title:'আবহাওয়া ও সক্রিয় সতর্কতা',
    lp_panel5_desc:'বর্তমান আবহাওয়া ও NWS জরুরি সতর্কতা লাইভ এবং ঐতিহাসিক দুর্যোগ দেখার জন্য ইন্টারেক্টিভ মানচিত্র।',
    lp_panel6_title:'পরিবার ট্র্যাকার',
    lp_panel6_desc:'পারিবারিক গ্রুপ তৈরি করুন, প্রতিটি সদস্যের প্রস্তুতির অগ্রগতি ট্র্যাক করুন এবং ডিভাইসের মধ্যে রিয়েল-টাইমে সিঙ্ক করুন।',
    lp_bottom_title:'আপনার অঞ্চলে কী ঘটছে তা দেখতে প্রস্তুত?',
    lp_bottom_sub:'শুধু আপনার শহর লিখুন। ১০ সেকেন্ডের কম সময় লাগে।',
    lp_bottom_cta:'আমার অঞ্চল দেখুন →', scroll_hint:'আরো দেখতে স্ক্রোল করুন', home_btn:'🏠 হোম',
  },
  ko: {
    lang_name:'KO', header_subtitle:'실시간 재난 모니터링 및 대비 체크리스트',
    search_label:'지역 검색', search_placeholder:'시, 도 또는 우편번호…',
    search_btn:'검색', geo_btn:'📍 내 위치 사용',
    empty_title:'지역을 검색하여 시작하세요',
    empty_msg:'도시를 입력하거나 현재 위치를 사용하여 최근 재난,<br>위험 분석 및 맞춤형 대비 체크리스트를 확인하세요.',
    loading_title:'지역 데이터를 불러오는 중…',
    loading_msg:'USGS 지진, NASA EONET 자연재해<br>및 NWS 기상 경보 조회 중',
    map_title:'🗺️ 이벤트 지도', time_machine:'⏱ 타임머신', all_time:'전체 기간',
    play:'▶ 재생', pause:'⏸ 일시정지',
    stat_quakes:'지진', stat_fires:'산불', stat_floods:'홍수', stat_alerts:'경보',
    risks_title:'⚠️ 주요 지역 위험 요소',
    day_btn:'일', week_btn:'주', month_btn:'월', yr_unit:'년',
    tracker_title:'👨‍👩‍👧 가족 트래커',
    family_placeholder:'새 그룹 이름…', add_family_btn:'+ 가족',
    join_placeholder:'참여 코드 입력…', join_btn:'참여',
    disasters_nav_btn:'🌋 자연재해',
    weather_nav_btn:'⛅ 날씨', checklist_nav_btn:'✅ 대비 체크리스트',
    back_menu:'← 메뉴로 돌아가기', back_results:'← 결과',
    checklist_title:'✅ 대비 체크리스트',
    checklist_subtitle:'지역 위험에 맞춤화 · 키트를 준비하면서 항목을 체크하세요',
    overall_prep:'전반적인 대비 수준',
    weather_title:'⛅ 현재 날씨', wind_speed:'풍속', precipitation:'강수량', feels_like:'체감 온도',
    share_btn:'🔗 공유', save_report_btn:'💾 보고서 저장',
    no_events:'선택한 기간 동안 이 지역에서 중요한 이벤트가 감지되지 않았습니다.',
    weighted_event:'가중 이벤트', weighted_events:'가중 이벤트',
    conf_high:'높은 신뢰도', conf_med:'중간 신뢰도', conf_low:'낮은 신뢰도',
    universal_name:'공통 필수품', universal_reason:'모든 유형의 비상 상황에 적용', reset_btn:'↺ 초기화',
    risk_earthquake:'지진', risk_wildfire:'산불', risk_flood:'홍수', risk_volcano:'화산',
    risk_storm:'강한 폭풍', risk_drought:'가뭄', risk_tornado:'토네이도', risk_hurricane:'허리케인',
    risk_winter_storm:'겨울 폭풍', risk_extreme_heat:'극심한 폭염', risk_severe_weather:'악천후',
    wmo_0:'맑음', wmo_1:'대체로 맑음', wmo_2:'구름 조금', wmo_3:'흐림',
    wmo_fog:'안개', wmo_drizzle:'이슬비', wmo_rain:'비', wmo_snow:'눈',
    wmo_rain_showers:'소나기', wmo_snow_showers:'눈 소나기', wmo_thunderstorm:'뇌우',
    ck_earthquake_reason:'해당 지역의 지진 활동을 기반으로',
    ck_wildfire_reason:'해당 지역에서 산불이 감지됨',
    ck_flood_reason:'인근 지역에서 홍수가 감지됨',
    ck_volcano_reason:'인근에서 화산 활동이 감지됨',
    ck_winter_storm_reason:'겨울 폭풍 위험 또는 경보 감지됨',
    ck_hurricane_reason:'허리케인 위험 또는 경보 감지됨',
    ck_tornado_reason:'토네이도 위험 또는 경보 감지됨',
    ck_extreme_heat_reason:'지역에서 폭염 경보 활성화됨',
    ck_storm_reason:'지역에서 폭풍 이벤트 감지됨',
    ck_drought_reason:'지역에서 가뭄 상태 감지됨',
    ck_severe_weather_reason:'이 지역의 일반적인 악천후 위험',
    lp_slogan:'당신의 지역. 당신의 위험. 당신의 계획.',
    lp_sub:'실시간 재난 데이터, 맞춤형 위험 분석, 대비 도구 — 정확한 위치에 맞게 제공, 무료.',
    lp_cta_start:'시작하기 →', lp_no_bs:'계정 불필요 · 영원히 무료',
    lp_source_label:'실시간 데이터 제공', lp_section_tag:'왜 선택하나요',
    lp_section_title:'또 다른 일반 재난 앱이 아닙니다',
    lp_section_sub:'대부분의 앱은 전국 뉴스를 보여줍니다. 저희는 정확한 주소에서 400km 이내에 무슨 일이 일어나고 있는지 분석합니다.',
    lp_panel1_title:'실시간 재난 데이터',
    lp_panel1_desc:'USGS의 지진 데이터, NASA EONET의 자연 재해, NWS의 활성 기상 경보를 실시간으로 가져옵니다.',
    lp_panel2_title:'초로컬 위험 분석',
    lp_panel2_desc:'정확한 좌표에서 400km 이내의 이벤트를 빈도와 가중 심각도로 순위를 매깁니다.',
    lp_panel3_title:'맞춤형 체크리스트',
    lp_panel3_desc:'지역 위험 프로필을 기반으로 대비 체크리스트를 구성합니다. 지진 지역? 지진 관련 항목을 받습니다.',
    lp_panel4_title:'재난 교육',
    lp_panel4_desc:'12가지 자연재해에 대한 상세 가이드 — 원인, 경고 신호, 대피 중 및 이후 행동 지침.',
    lp_panel5_title:'날씨 및 활성 경보',
    lp_panel5_desc:'현재 기상 상태와 NWS 긴급 경보, 역사적 재난을 시간대별로 볼 수 있는 인터랙티브 지도.',
    lp_panel6_title:'가족 트래커',
    lp_panel6_desc:'가족 그룹을 만들고, 각 구성원의 대비 현황을 추적하며, 기기 간 실시간 동기화 — 등록 불필요.',
    lp_bottom_title:'내 지역에 무슨 일이 일어나고 있는지 확인할 준비가 됐나요?',
    lp_bottom_sub:'도시만 입력하면 됩니다. 10초도 안 걸립니다.',
    lp_bottom_cta:'내 지역 확인하기 →', scroll_hint:'아래로 스크롤하여 더 보기', home_btn:'🏠 홈',
  },
  tr: {
    lang_name:'TR', header_subtitle:'Gerçek zamanlı afet takibi ve hazırlık listesi',
    search_label:'Bölgenizi arayın', search_placeholder:'Şehir, il veya posta kodu…',
    search_btn:'Ara', geo_btn:'📍 Konumumu Kullan',
    empty_title:'Başlamak için bölgenizi arayın',
    empty_msg:'Son afetleri, risk analizini ve kişisel hazırlık listesini görmek için<br>bir şehir girin veya konumunuzu kullanın.',
    loading_title:'Bölgesel veriler yükleniyor…',
    loading_msg:'USGS depremleri, NASA EONET doğal olaylar<br>ve NWS hava uyarıları sorgulanıyor',
    map_title:'🗺️ Olay Haritası', time_machine:'⏱ Zaman Makinesi', all_time:'Tüm zamanlar',
    play:'▶ Oynat', pause:'⏸ Duraklat',
    stat_quakes:'Depremler', stat_fires:'Yangınlar', stat_floods:'Seller', stat_alerts:'Uyarılar',
    risks_title:'⚠️ Başlıca Bölgesel Riskler',
    day_btn:'Gün', week_btn:'Hafta', month_btn:'Ay', yr_unit:'yıl',
    tracker_title:'👨‍👩‍👧 Aile Takipçisi',
    family_placeholder:'Yeni grup adı…', add_family_btn:'+ Aile',
    join_placeholder:'Katılmak için kod girin…', join_btn:'Katıl',
    disasters_nav_btn:'🌋 Doğal Afetler',
    weather_nav_btn:'⛅ Hava Durumu', checklist_nav_btn:'✅ Hazırlık Listesi',
    back_menu:'← Menüye Dön', back_results:'← Sonuçlar',
    checklist_title:'✅ Hazırlık Listesi',
    checklist_subtitle:'Bölgesel risklere göre özelleştirilmiş · Kiti hazırlarken öğeleri işaretleyin',
    overall_prep:'Genel Hazırlık',
    weather_title:'⛅ Güncel Hava Durumu', wind_speed:'Rüzgar Hızı', precipitation:'Yağış', feels_like:'Hissedilen',
    share_btn:'🔗 Paylaş', save_report_btn:'💾 Raporu Kaydet',
    no_events:'Seçilen dönem için bu bölgede önemli bir olay tespit edilmedi.',
    weighted_event:'ağırlıklı olay', weighted_events:'ağırlıklı olay',
    conf_high:'Yüksek güven', conf_med:'Orta güven', conf_low:'Düşük güven',
    universal_name:'Evrensel Temel Malzemeler', universal_reason:'Her türlü acil duruma uygulanabilir', reset_btn:'↺ Sıfırla',
    risk_earthquake:'Deprem', risk_wildfire:'Orman Yangını', risk_flood:'Sel', risk_volcano:'Volkan',
    risk_storm:'Şiddetli Fırtına', risk_drought:'Kuraklık', risk_tornado:'Hortum', risk_hurricane:'Kasırga',
    risk_winter_storm:'Kış Fırtınası', risk_extreme_heat:'Aşırı Sıcak', risk_severe_weather:'Şiddetli Hava',
    wmo_0:'Açık Hava', wmo_1:'Çoğunlukla Açık', wmo_2:'Parçalı Bulutlu', wmo_3:'Bulutlu',
    wmo_fog:'Sis', wmo_drizzle:'Çisenti', wmo_rain:'Yağmur', wmo_snow:'Kar',
    wmo_rain_showers:'Sağanak', wmo_snow_showers:'Kar Sağanağı', wmo_thunderstorm:'Gök Gürültülü Fırtına',
    ck_earthquake_reason:'Bölgenizdeki sismik aktiviteye dayanarak',
    ck_wildfire_reason:'Bölgenizde orman yangını tespit edildi',
    ck_flood_reason:'Bölgenize yakın sel tespit edildi',
    ck_volcano_reason:'Bölgenize yakın volkanik aktivite tespit edildi',
    ck_winter_storm_reason:'Kış fırtınası riski veya uyarıları tespit edildi',
    ck_hurricane_reason:'Kasırga riski veya uyarıları tespit edildi',
    ck_tornado_reason:'Hortum riski veya uyarıları tespit edildi',
    ck_extreme_heat_reason:'Bölgede aşırı sıcak uyarıları aktif',
    ck_storm_reason:'Bölgede fırtına olayları tespit edildi',
    ck_drought_reason:'Bölgede kuraklık koşulları tespit edildi',
    ck_severe_weather_reason:'Bu bölge için genel şiddetli hava riski',
    lp_slogan:'Bölgeniz. Riskleriniz. Planınız.',
    lp_sub:'Gerçek zamanlı afet verileri, kişisel risk analizi ve hazırlık araçları — tam konumunuz için, ücretsiz.',
    lp_cta_start:'Başlayın →', lp_no_bs:'Hesap gerekmez · Sonsuza kadar ücretsiz',
    lp_source_label:'Canlı veri kaynağı', lp_section_tag:'Neden biz',
    lp_section_title:'Başka bir genel acil durum uygulaması değil',
    lp_section_sub:'Çoğu uygulama ulusal haberleri gösterir. Biz, tam adresinizden 400 km yarıçap içinde neler olduğunu analiz ederiz.',
    lp_panel1_title:'Canlı Afet Verileri',
    lp_panel1_desc:"USGS'den deprem verileri, NASA EONET'ten doğal olaylar ve NWS'den aktif hava uyarılarını gerçek zamanlı olarak çeker.",
    lp_panel2_title:'Hiper-Yerel Risk Analizi',
    lp_panel2_desc:'Tam koordinatlarınızdan 400 km içindeki olaylar, frekans ve ağırlıklı şiddet bazında sıralanır.',
    lp_panel3_title:'Kişisel Kontrol Listeleri',
    lp_panel3_desc:'Hazırlık listeniz, bölgesel risk profilinizden oluşturulur. Deprem bölgesi? Deprem maddeleri alırsınız.',
    lp_panel4_title:'Afet Eğitimi',
    lp_panel4_desc:'12 tür doğal afet için ayrıntılı kılavuzlar — nedenler, uyarı işaretleri, sırasında ve sonrasında yapılacaklar.',
    lp_panel5_title:'Hava Durumu ve Aktif Uyarılar',
    lp_panel5_desc:'Bölgeniz için güncel hava koşulları ve canlı NWS acil uyarıları, ayrıca geçmiş afetleri zaman içinde görselleştiren harita.',
    lp_panel6_title:'Aile Takipçisi',
    lp_panel6_desc:'Aile grupları oluşturun, her üyenin hazırlık ilerlemesini takip edin ve cihazlar arasında gerçek zamanlı senkronize edin.',
    lp_bottom_title:'Bölgenizde neler olduğunu görmeye hazır mısınız?',
    lp_bottom_sub:'Sadece şehrinizi girin. 10 saniyeden az sürer.',
    lp_bottom_cta:'Bölgemi Gör →', scroll_hint:'Daha fazlası için kaydırın', home_btn:'🏠 Ana Sayfa',
  },
  vi: {
    lang_name:'VI', header_subtitle:'Theo dõi thảm họa thời gian thực và danh sách chuẩn bị',
    search_label:'Tìm kiếm khu vực của bạn', search_placeholder:'Thành phố, tỉnh, hoặc mã bưu chính…',
    search_btn:'Tìm kiếm', geo_btn:'📍 Dùng Vị Trí Của Tôi',
    empty_title:'Tìm kiếm khu vực của bạn để bắt đầu',
    empty_msg:'Nhập thành phố hoặc dùng vị trí của bạn để xem các sự kiện gần đây,<br>phân tích rủi ro và danh sách chuẩn bị cá nhân.',
    loading_title:'Đang tải dữ liệu khu vực…',
    loading_msg:'Đang truy vấn động đất USGS, sự kiện NASA EONET<br>và cảnh báo thời tiết NWS',
    map_title:'🗺️ Bản Đồ Sự Kiện', time_machine:'⏱ Cỗ Máy Thời Gian', all_time:'Toàn bộ thời gian',
    play:'▶ Phát', pause:'⏸ Tạm dừng',
    stat_quakes:'Động đất', stat_fires:'Cháy rừng', stat_floods:'Lũ lụt', stat_alerts:'Cảnh báo',
    risks_title:'⚠️ Rủi Ro Khu Vực Hàng Đầu',
    day_btn:'Ngày', week_btn:'Tuần', month_btn:'Tháng', yr_unit:'năm',
    tracker_title:'👨‍👩‍👧 Theo Dõi Gia Đình',
    family_placeholder:'Tên nhóm mới…', add_family_btn:'+ Gia đình',
    join_placeholder:'Nhập mã để tham gia…', join_btn:'Tham gia',
    disasters_nav_btn:'🌋 Thảm Họa Tự Nhiên',
    weather_nav_btn:'⛅ Thời Tiết', checklist_nav_btn:'✅ Danh Sách Chuẩn Bị',
    back_menu:'← Quay lại Menu', back_results:'← Kết quả',
    checklist_title:'✅ Danh Sách Chuẩn Bị',
    checklist_subtitle:'Được tùy chỉnh theo rủi ro khu vực · đánh dấu các mục khi chuẩn bị',
    overall_prep:'Mức Độ Chuẩn Bị Tổng Thể',
    weather_title:'⛅ Thời Tiết Hiện Tại', wind_speed:'Tốc Độ Gió', precipitation:'Lượng Mưa', feels_like:'Cảm Giác Như',
    share_btn:'🔗 Chia sẻ', save_report_btn:'💾 Lưu Báo Cáo',
    no_events:'Không phát hiện sự kiện đáng kể nào ở khu vực này trong giai đoạn đã chọn.',
    weighted_event:'sự kiện có trọng số', weighted_events:'sự kiện có trọng số',
    conf_high:'Độ tin cậy cao', conf_med:'Độ tin cậy trung bình', conf_low:'Độ tin cậy thấp',
    universal_name:'Vật Dụng Cần Thiết Phổ Quát', universal_reason:'Áp dụng cho mọi loại khẩn cấp', reset_btn:'↺ Đặt lại',
    risk_earthquake:'Động đất', risk_wildfire:'Cháy rừng', risk_flood:'Lũ lụt', risk_volcano:'Núi lửa',
    risk_storm:'Bão mạnh', risk_drought:'Hạn hán', risk_tornado:'Lốc xoáy', risk_hurricane:'Bão nhiệt đới',
    risk_winter_storm:'Bão mùa đông', risk_extreme_heat:'Nắng cực đoan', risk_severe_weather:'Thời tiết khắc nghiệt',
    wmo_0:'Trời quang', wmo_1:'Chủ yếu quang', wmo_2:'Mây rải rác', wmo_3:'Nhiều mây',
    wmo_fog:'Sương mù', wmo_drizzle:'Mưa phùn', wmo_rain:'Mưa', wmo_snow:'Tuyết',
    wmo_rain_showers:'Mưa rào', wmo_snow_showers:'Mưa tuyết', wmo_thunderstorm:'Giông bão',
    ck_earthquake_reason:'Dựa trên hoạt động địa chấn được phát hiện trong khu vực của bạn',
    ck_wildfire_reason:'Phát hiện cháy rừng trong khu vực của bạn',
    ck_flood_reason:'Phát hiện lũ lụt gần khu vực của bạn',
    ck_volcano_reason:'Phát hiện hoạt động núi lửa gần khu vực của bạn',
    ck_winter_storm_reason:'Phát hiện rủi ro bão mùa đông hoặc cảnh báo',
    ck_hurricane_reason:'Phát hiện rủi ro bão hoặc cảnh báo',
    ck_tornado_reason:'Phát hiện rủi ro lốc xoáy hoặc cảnh báo',
    ck_extreme_heat_reason:'Cảnh báo nắng cực đoan đang hoạt động trong khu vực',
    ck_storm_reason:'Phát hiện sự kiện bão trong khu vực',
    ck_drought_reason:'Phát hiện điều kiện hạn hán trong khu vực',
    ck_severe_weather_reason:'Rủi ro thời tiết khắc nghiệt chung cho khu vực này',
    lp_slogan:'Khu vực của bạn. Rủi ro của bạn. Kế hoạch của bạn.',
    lp_sub:'Dữ liệu thảm họa thời gian thực, phân tích rủi ro cá nhân và công cụ chuẩn bị — được xây dựng xung quanh vị trí chính xác của bạn, miễn phí.',
    lp_cta_start:'Bắt đầu →', lp_no_bs:'Không cần tài khoản · Miễn phí mãi mãi',
    lp_source_label:'Dữ liệu trực tiếp từ', lp_section_tag:'Tại sao chọn chúng tôi',
    lp_section_title:'Không phải ứng dụng khẩn cấp thông thường',
    lp_section_sub:'Hầu hết các ứng dụng hiển thị tin tức quốc gia. Chúng tôi phân tích những gì đang xảy ra trong bán kính 400 km từ địa chỉ chính xác của bạn.',
    lp_panel1_title:'Dữ Liệu Thảm Họa Trực Tiếp',
    lp_panel1_desc:'Lấy dữ liệu động đất từ USGS, sự kiện tự nhiên từ NASA EONET và cảnh báo thời tiết từ NWS trong thời gian thực.',
    lp_panel2_title:'Phân Tích Rủi Ro Siêu Cục Bộ',
    lp_panel2_desc:'Các sự kiện trong 400 km quanh tọa độ chính xác của bạn được xếp hạng theo tần suất và mức độ nghiêm trọng có trọng số.',
    lp_panel3_title:'Danh Sách Kiểm Tra Cá Nhân',
    lp_panel3_desc:'Danh sách chuẩn bị được xây dựng từ hồ sơ rủi ro khu vực của bạn. Vùng địa chấn? Bạn nhận được các mục về động đất.',
    lp_panel4_title:'Giáo Dục Về Thảm Họa',
    lp_panel4_desc:'Hướng dẫn chi tiết cho 12 loại thảm họa tự nhiên — nguyên nhân, dấu hiệu cảnh báo, việc cần làm trong và sau thảm họa.',
    lp_panel5_title:'Thời Tiết và Cảnh Báo Đang Hoạt Động',
    lp_panel5_desc:'Điều kiện thời tiết hiện tại và cảnh báo khẩn cấp NWS trực tiếp, cộng với bản đồ tương tác để xem thảm họa lịch sử.',
    lp_panel6_title:'Theo Dõi Gia Đình',
    lp_panel6_desc:'Tạo nhóm gia đình, theo dõi tiến độ chuẩn bị của từng thành viên và đồng bộ hóa thời gian thực giữa các thiết bị.',
    lp_bottom_title:'Bạn đã sẵn sàng xem những gì đang xảy ra ở khu vực của mình chưa?',
    lp_bottom_sub:'Chỉ cần nhập thành phố của bạn. Mất chưa đến 10 giây.',
    lp_bottom_cta:'Xem Khu Vực Của Tôi →', scroll_hint:'Cuộn xuống để xem thêm', home_btn:'🏠 Trang Chủ',
  },
  id: {
    lang_name:'ID', header_subtitle:'Pemantauan bencana real-time dan daftar kesiapsiagaan',
    search_label:'Cari wilayah Anda', search_placeholder:'Kota, provinsi, atau kode pos…',
    search_btn:'Cari', geo_btn:'📍 Gunakan Lokasi Saya',
    empty_title:'Cari wilayah Anda untuk mulai',
    empty_msg:'Masukkan kota atau gunakan lokasi Anda untuk melihat kejadian terbaru,<br>analisis risiko, dan daftar kesiapsiagaan pribadi.',
    loading_title:'Memuat data wilayah…',
    loading_msg:'Mengkueri gempa USGS, kejadian NASA EONET<br>dan peringatan cuaca NWS',
    map_title:'🗺️ Peta Kejadian', time_machine:'⏱ Mesin Waktu', all_time:'Semua waktu',
    play:'▶ Putar', pause:'⏸ Jeda',
    stat_quakes:'Gempa', stat_fires:'Kebakaran', stat_floods:'Banjir', stat_alerts:'Peringatan',
    risks_title:'⚠️ Risiko Wilayah Utama',
    day_btn:'Hari', week_btn:'Minggu', month_btn:'Bulan', yr_unit:'tahun',
    tracker_title:'👨‍👩‍👧 Pelacak Keluarga',
    family_placeholder:'Nama grup baru…', add_family_btn:'+ Keluarga',
    join_placeholder:'Masukkan kode untuk bergabung…', join_btn:'Bergabung',
    disasters_nav_btn:'🌋 Bencana Alam',
    weather_nav_btn:'⛅ Cuaca', checklist_nav_btn:'✅ Daftar Kesiapsiagaan',
    back_menu:'← Kembali ke Menu', back_results:'← Hasil',
    checklist_title:'✅ Daftar Kesiapsiagaan',
    checklist_subtitle:'Disesuaikan dengan risiko wilayah Anda · centang item saat menyiapkan perlengkapan',
    overall_prep:'Kesiapsiagaan Keseluruhan',
    weather_title:'⛅ Cuaca Saat Ini', wind_speed:'Kecepatan Angin', precipitation:'Curah Hujan', feels_like:'Terasa Seperti',
    share_btn:'🔗 Bagikan', save_report_btn:'💾 Simpan Laporan',
    no_events:'Tidak ada kejadian signifikan yang terdeteksi di wilayah ini untuk periode yang dipilih.',
    weighted_event:'kejadian berbobot', weighted_events:'kejadian berbobot',
    conf_high:'Kepercayaan tinggi', conf_med:'Kepercayaan sedang', conf_low:'Kepercayaan rendah',
    universal_name:'Perlengkapan Universal', universal_reason:'Berlaku untuk semua jenis darurat', reset_btn:'↺ Reset',
    risk_earthquake:'Gempa Bumi', risk_wildfire:'Kebakaran Hutan', risk_flood:'Banjir', risk_volcano:'Gunung Berapi',
    risk_storm:'Badai Parah', risk_drought:'Kekeringan', risk_tornado:'Tornado', risk_hurricane:'Badai Tropis',
    risk_winter_storm:'Badai Musim Dingin', risk_extreme_heat:'Panas Ekstrem', risk_severe_weather:'Cuaca Buruk',
    wmo_0:'Langit Cerah', wmo_1:'Sebagian Besar Cerah', wmo_2:'Berawan Sebagian', wmo_3:'Mendung',
    wmo_fog:'Kabut', wmo_drizzle:'Gerimis', wmo_rain:'Hujan', wmo_snow:'Salju',
    wmo_rain_showers:'Hujan Lebat', wmo_snow_showers:'Hujan Salju', wmo_thunderstorm:'Badai Petir',
    ck_earthquake_reason:'Berdasarkan aktivitas seismik yang terdeteksi di wilayah Anda',
    ck_wildfire_reason:'Kebakaran hutan terdeteksi di wilayah Anda',
    ck_flood_reason:'Banjir terdeteksi dekat wilayah Anda',
    ck_volcano_reason:'Aktivitas gunung berapi terdeteksi dekat wilayah Anda',
    ck_winter_storm_reason:'Risiko badai musim dingin atau peringatan terdeteksi',
    ck_hurricane_reason:'Risiko badai tropis atau peringatan terdeteksi',
    ck_tornado_reason:'Risiko tornado atau peringatan terdeteksi',
    ck_extreme_heat_reason:'Peringatan panas ekstrem aktif di wilayah',
    ck_storm_reason:'Kejadian badai terdeteksi di wilayah',
    ck_drought_reason:'Kondisi kekeringan terdeteksi di wilayah',
    ck_severe_weather_reason:'Risiko cuaca buruk umum untuk wilayah ini',
    lp_slogan:'Wilayah Anda. Risiko Anda. Rencana Anda.',
    lp_sub:'Data bencana real-time, analisis risiko personal, dan alat kesiapsiagaan — dibangun untuk lokasi Anda yang tepat, gratis.',
    lp_cta_start:'Mulai →', lp_no_bs:'Tidak perlu akun · Gratis selamanya',
    lp_source_label:'Data langsung dari', lp_section_tag:'Mengapa memilih kami',
    lp_section_title:'Bukan aplikasi darurat biasa',
    lp_section_sub:'Kebanyakan aplikasi menampilkan berita nasional. Kami menganalisis apa yang terjadi dalam radius 400 km dari alamat Anda.',
    lp_panel1_title:'Data Bencana Langsung',
    lp_panel1_desc:'Mengambil data gempa dari USGS, kejadian alam dari NASA EONET, dan peringatan cuaca dari NWS secara real-time setiap pencarian.',
    lp_panel2_title:'Analisis Risiko Hiper-Lokal',
    lp_panel2_desc:'Kejadian dalam 400 km dari koordinat Anda diurutkan berdasarkan frekuensi dan tingkat keparahan berbobot.',
    lp_panel3_title:'Daftar Periksa Personal',
    lp_panel3_desc:'Daftar kesiapsiagaan Anda dibuat berdasarkan profil risiko wilayah. Zona gempa? Anda mendapat item gempa.',
    lp_panel4_title:'Edukasi Bencana',
    lp_panel4_desc:'Panduan lengkap untuk 12 jenis bencana alam — penyebab, tanda peringatan, tindakan selama dan setelah bencana.',
    lp_panel5_title:'Cuaca dan Peringatan Aktif',
    lp_panel5_desc:'Kondisi cuaca terkini dan peringatan darurat NWS langsung, plus peta interaktif untuk melihat bencana historis dari waktu ke waktu.',
    lp_panel6_title:'Pelacak Keluarga',
    lp_panel6_desc:'Buat grup keluarga, lacak kemajuan kesiapsiagaan setiap anggota, dan sinkronkan real-time antar perangkat tanpa pendaftaran.',
    lp_bottom_title:'Siap melihat apa yang terjadi di wilayah Anda?',
    lp_bottom_sub:'Cukup masukkan kota Anda. Kurang dari 10 detik.',
    lp_bottom_cta:'Lihat Wilayah Saya →', scroll_hint:'Gulir untuk melihat lebih', home_btn:'🏠 Beranda',
  },
  pl: {
    lang_name:'PL', header_subtitle:'Monitorowanie klęsk żywiołowych w czasie rzeczywistym i lista przygotowania',
    search_label:'Wyszukaj swój region', search_placeholder:'Miasto, województwo lub kod pocztowy…',
    search_btn:'Szukaj', geo_btn:'📍 Użyj mojej lokalizacji',
    empty_title:'Wyszukaj swój region, aby rozpocząć',
    empty_msg:'Wpisz miasto lub użyj lokalizacji, aby zobaczyć ostatnie zdarzenia,<br>analizę ryzyka i spersonalizowaną listę przygotowania.',
    loading_title:'Ładowanie danych regionalnych…',
    loading_msg:'Pobieranie trzęsień ziemi USGS, zdarzeń NASA EONET<br>i ostrzeżeń pogodowych NWS',
    map_title:'🗺️ Mapa zdarzeń', time_machine:'⏱ Wehikuł czasu', all_time:'Cały czas',
    play:'▶ Odtwórz', pause:'⏸ Pauza',
    stat_quakes:'Trzęsienia', stat_fires:'Pożary', stat_floods:'Powodzie', stat_alerts:'Ostrzeżenia',
    risks_title:'⚠️ Główne ryzyka regionalne',
    day_btn:'Dzień', week_btn:'Tydzień', month_btn:'Miesiąc', yr_unit:'rok',
    tracker_title:'👨‍👩‍👧 Śledzenie rodziny',
    family_placeholder:'Nazwa nowej grupy…', add_family_btn:'+ Rodzina',
    join_placeholder:'Wpisz kod, aby dołączyć…', join_btn:'Dołącz',
    disasters_nav_btn:'🌋 Klęski żywiołowe',
    weather_nav_btn:'⛅ Pogoda', checklist_nav_btn:'✅ Lista przygotowania',
    back_menu:'← Powrót do menu', back_results:'← Wyniki',
    checklist_title:'✅ Lista przygotowania',
    checklist_subtitle:'Dostosowana do Twoich ryzyk regionalnych · zaznaczaj elementy podczas kompletowania zestawu',
    overall_prep:'Ogólne przygotowanie',
    weather_title:'⛅ Aktualna pogoda', wind_speed:'Prędkość wiatru', precipitation:'Opady', feels_like:'Odczuwalna',
    share_btn:'🔗 Udostępnij', save_report_btn:'💾 Zapisz raport',
    no_events:'Brak znaczących zdarzeń wykrytych w tym regionie dla wybranego okresu.',
    weighted_event:'ważone zdarzenie', weighted_events:'ważone zdarzenia',
    conf_high:'Wysokie zaufanie', conf_med:'Średnie zaufanie', conf_low:'Niskie zaufanie',
    universal_name:'Niezbędniki uniwersalne', universal_reason:'Dotyczy wszystkich rodzajów sytuacji awaryjnych', reset_btn:'↺ Resetuj',
    risk_earthquake:'Trzęsienie ziemi', risk_wildfire:'Pożar lasu', risk_flood:'Powódź', risk_volcano:'Wulkan',
    risk_storm:'Silna burza', risk_drought:'Susza', risk_tornado:'Tornado', risk_hurricane:'Huragan',
    risk_winter_storm:'Burza zimowa', risk_extreme_heat:'Ekstremalne upały', risk_severe_weather:'Niebezpieczna pogoda',
    wmo_0:'Bezchmurnie', wmo_1:'Przeważnie pogodnie', wmo_2:'Częściowe zachmurzenie', wmo_3:'Pochmurno',
    wmo_fog:'Mgła', wmo_drizzle:'Mżawka', wmo_rain:'Deszcz', wmo_snow:'Śnieg',
    wmo_rain_showers:'Przelotne opady', wmo_snow_showers:'Opady śniegu', wmo_thunderstorm:'Burza',
    ck_earthquake_reason:'Na podstawie aktywności sejsmicznej wykrytej w Twoim obszarze',
    ck_wildfire_reason:'Wykryto pożary lasów w Twoim regionie',
    ck_flood_reason:'Wykryto powodzie w pobliżu Twojego regionu',
    ck_volcano_reason:'Wykryto aktywność wulkaniczną w pobliżu Twojego regionu',
    ck_winter_storm_reason:'Wykryto ryzyko burzy zimowej lub ostrzeżenia',
    ck_hurricane_reason:'Wykryto ryzyko huraganu lub ostrzeżenia',
    ck_tornado_reason:'Wykryto ryzyko tornada lub ostrzeżenia',
    ck_extreme_heat_reason:'Aktywne ostrzeżenia o ekstremalnym upale w regionie',
    ck_storm_reason:'Wykryto zdarzenia burzowe w regionie',
    ck_drought_reason:'Wykryto warunki suszy w regionie',
    ck_severe_weather_reason:'Ogólne ryzyko niebezpiecznej pogody dla tego regionu',
    lp_slogan:'Twój region. Twoje ryzyko. Twój plan.',
    lp_sub:'Dane o klęskach żywiołowych w czasie rzeczywistym, spersonalizowana analiza ryzyka i narzędzia przygotowania — dla Twojej dokładnej lokalizacji, za darmo.',
    lp_cta_start:'Zacznij →', lp_no_bs:'Bez konta · Zawsze darmowe',
    lp_source_label:'Dane na żywo od', lp_section_tag:'Dlaczego my',
    lp_section_title:'Nie kolejna ogólna aplikacja ratunkowa',
    lp_section_sub:'Większość aplikacji wyświetla krajowe nagłówki. My analizujemy, co dzieje się w promieniu 400 km od Twojego adresu.',
    lp_panel1_title:'Dane o klęskach na żywo',
    lp_panel1_desc:'Pobiera dane o trzęsieniach ziemi z USGS, zdarzeniach naturalnych z NASA EONET i ostrzeżeniach pogodowych z NWS w czasie rzeczywistym.',
    lp_panel2_title:'Hiper-lokalna analiza ryzyka',
    lp_panel2_desc:'Zdarzenia w promieniu 400 km od Twoich współrzędnych są klasyfikowane według częstotliwości i ważonej poważności.',
    lp_panel3_title:'Spersonalizowane listy kontrolne',
    lp_panel3_desc:'Lista przygotowania jest tworzona na podstawie Twojego regionalnego profilu ryzyka. Strefa sejsmiczna? Otrzymujesz pozycje związane z trzęsieniami ziemi.',
    lp_panel4_title:'Edukacja o klęskach',
    lp_panel4_desc:'Szczegółowe przewodniki dla 12 rodzajów klęsk żywiołowych — przyczyny, sygnały ostrzegawcze, co robić podczas i po zdarzeniu.',
    lp_panel5_title:'Pogoda i aktywne ostrzeżenia',
    lp_panel5_desc:'Aktualne warunki pogodowe i ostrzeżenia NWS na żywo, plus interaktywna mapa historycznych zdarzeń klęsk żywiołowych.',
    lp_panel6_title:'Śledzenie rodziny',
    lp_panel6_desc:'Twórz grupy rodzinne, śledź postęp przygotowania każdego członka i synchronizuj w czasie rzeczywistym między urządzeniami.',
    lp_bottom_title:'Gotowy zobaczyć, co dzieje się w Twoim regionie?',
    lp_bottom_sub:'Wystarczy wpisać swoje miasto. Zajmuje mniej niż 10 sekund.',
    lp_bottom_cta:'Zobacz Mój Region →', scroll_hint:'Przewiń, aby zobaczyć więcej', home_btn:'🏠 Strona Główna',
  },
  uk: {
    lang_name:'UK', header_subtitle:'Моніторинг стихійних лих у реальному часі та список готовності',
    search_label:'Пошук вашого регіону', search_placeholder:'Місто, область або індекс…',
    search_btn:'Пошук', geo_btn:'📍 Використати моє місцезнаходження',
    empty_title:'Знайдіть свій регіон для початку',
    empty_msg:'Введіть місто або використайте своє місцезнаходження для перегляду останніх подій,<br>аналізу ризиків та персоналізованого контрольного списку.',
    loading_title:'Завантаження регіональних даних…',
    loading_msg:'Запит землетрусів USGS, подій NASA EONET<br>та попереджень NWS',
    map_title:'🗺️ Карта подій', time_machine:'⏱ Машина часу', all_time:'Весь час',
    play:'▶ Відтворити', pause:'⏸ Пауза',
    stat_quakes:'Землетруси', stat_fires:'Пожежі', stat_floods:'Повені', stat_alerts:'Попередження',
    risks_title:'⚠️ Головні регіональні ризики',
    day_btn:'День', week_btn:'Тиждень', month_btn:'Місяць', yr_unit:'рік',
    tracker_title:'👨‍👩‍👧 Трекер домогосподарства',
    family_placeholder:'Назва нової сім\'ї…', add_family_btn:'+ Сім\'я',
    join_placeholder:'Введіть код для приєднання…', join_btn:'Приєднатися',
    disasters_nav_btn:'🌋 Стихійні лиха',
    weather_nav_btn:'⛅ Погода', checklist_nav_btn:'✅ Контрольний список',
    back_menu:'← Назад до меню', back_results:'← Результати',
    checklist_title:'✅ Контрольний список готовності',
    checklist_subtitle:'Адаптований до ваших ризиків · відмічайте пункти під час підготовки',
    overall_prep:'Загальна готовність',
    weather_title:'⛅ Поточна погода', wind_speed:'Швидкість вітру', precipitation:'Опади', feels_like:'Відчувається як',
    share_btn:'🔗 Поділитися', save_report_btn:'💾 Зберегти звіт',
    no_events:'Для вибраного періоду в цьому регіоні значних подій не виявлено.',
    weighted_event:'зважена подія', weighted_events:'зважених подій',
    conf_high:'Висока достовірність', conf_med:'Середня достовірність', conf_low:'Низька достовірність',
    universal_name:'Універсальні необхідні речі', universal_reason:'Застосовується до будь-якої надзвичайної ситуації', reset_btn:'↺ Скинути',
    risk_earthquake:'Землетрус', risk_wildfire:'Лісова пожежа', risk_flood:'Повінь', risk_volcano:'Вулкан',
    risk_storm:'Сильна буря', risk_drought:'Посуха', risk_tornado:'Торнадо', risk_hurricane:'Ураган',
    risk_winter_storm:'Зимова буря', risk_extreme_heat:'Екстремальна спека', risk_severe_weather:'Небезпечні метеоявища',
    wmo_0:'Ясне небо', wmo_1:'Переважно ясно', wmo_2:'Мінлива хмарність', wmo_3:'Похмуро',
    wmo_fog:'Туман', wmo_drizzle:'Мряка', wmo_rain:'Дощ', wmo_snow:'Сніг',
    wmo_rain_showers:'Злива', wmo_snow_showers:'Снігопад', wmo_thunderstorm:'Гроза',
    ck_earthquake_reason:'На основі сейсмічної активності у вашому регіоні',
    ck_wildfire_reason:'У вашому регіоні виявлено лісові пожежі',
    ck_flood_reason:'Поблизу вашого регіону виявлено повені',
    ck_volcano_reason:'Поблизу вашого регіону виявлено вулканічну активність',
    ck_winter_storm_reason:'Виявлено ризик зимової бурі або попередження',
    ck_hurricane_reason:'Виявлено ризик урагану або попередження',
    ck_tornado_reason:'Виявлено ризик торнадо або попередження',
    ck_extreme_heat_reason:'У регіоні діють попередження про екстремальну спеку',
    ck_storm_reason:'У регіоні виявлено штормові явища',
    ck_drought_reason:'У регіоні виявлено умови посухи',
    ck_severe_weather_reason:'Загальний ризик небезпечних метеоявищ для цього регіону',
    lp_slogan:'Ваш регіон. Ваші ризики. Ваш план.',
    lp_sub:'Дані про стихійні лиха в реальному часі, персоналізований аналіз ризиків та інструменти підготовки — для вашого місцезнаходження, безкоштовно.',
    lp_cta_start:'Почати →', lp_no_bs:'Реєстрація не потрібна · Завжди безкоштовно',
    lp_source_label:'Дані в реальному часі від', lp_section_tag:'Чому ми',
    lp_section_title:'Не ще один типовий застосунок про надзвичайні ситуації',
    lp_section_sub:'Більшість застосунків показують національні новини. Ми аналізуємо, що відбувається в радіусі 400 км від вашої адреси.',
    lp_panel1_title:'Дані про лиха в реальному часі',
    lp_panel1_desc:'Отримує дані про землетруси з USGS, природні події з NASA EONET та попередження з NWS в реальному часі при кожному пошуку.',
    lp_panel2_title:'Гіперлокальний аналіз ризиків',
    lp_panel2_desc:'Події в радіусі 400 км від ваших координат ранжуються за частотою та зваженою серйозністю.',
    lp_panel3_title:'Персональні контрольні списки',
    lp_panel3_desc:'Список готовності формується з вашого регіонального профілю ризиків. Сейсмічна зона? Отримаєте пункти для землетрусів.',
    lp_panel4_title:'Освіта про катастрофи',
    lp_panel4_desc:'Детальні посібники для 12 типів стихійних лих — причини, попереджувальні ознаки, що робити під час і після події.',
    lp_panel5_title:'Погода та активні попередження',
    lp_panel5_desc:'Поточні погодні умови та екстрені попередження NWS в реальному часі, плюс інтерактивна карта.',
    lp_panel6_title:'Трекер домогосподарства',
    lp_panel6_desc:'Створюйте сімейні групи, відстежуйте готовність кожного члена та синхронізуйте між пристроями в реальному часі.',
    lp_bottom_title:'Готові дізнатися, що відбувається у вашому регіоні?',
    lp_bottom_sub:'Просто введіть своє місто. Займає менше 10 секунд.',
    lp_bottom_cta:'Перевірити мій регіон →', scroll_hint:'Прокрутіть вниз', home_btn:'🏠 Головна',
  },
  tl: {
    lang_name:'TL', header_subtitle:'Real-time na pagmamasid sa sakuna at listahan ng paghahanda',
    search_label:'Hanapin ang iyong rehiyon', search_placeholder:'Lungsod, lalawigan, o zip code…',
    search_btn:'Hanapin', geo_btn:'📍 Gamitin ang Aking Lokasyon',
    empty_title:'Hanapin ang iyong rehiyon para magsimula',
    empty_msg:'Mag-type ng lungsod o gamitin ang iyong lokasyon para makita ang mga kamakailang pangyayari,<br>pagsusuri ng panganib, at personalisadong listahan ng paghahanda.',
    loading_title:'Naglo-load ng datos ng rehiyon…',
    loading_msg:'Kinukuha ang mga lindol mula USGS, mga natural na pangyayari mula NASA EONET<br>at mga babala sa panahon mula NWS',
    map_title:'🗺️ Mapa ng Pangyayari', time_machine:'⏱ Time Machine', all_time:'Lahat ng oras',
    play:'▶ I-play', pause:'⏸ I-pause',
    stat_quakes:'Mga Lindol', stat_fires:'Mga Sunog', stat_floods:'Mga Baha', stat_alerts:'Mga Babala',
    risks_title:'⚠️ Nangungunang Panganib sa Rehiyon',
    day_btn:'Araw', week_btn:'Linggo', month_btn:'Buwan', yr_unit:'taon',
    tracker_title:'👨‍👩‍👧 Tracker ng Pamilya',
    family_placeholder:'Pangalan ng bagong grupo…', add_family_btn:'+ Pamilya',
    join_placeholder:'Ilagay ang code para sumali…', join_btn:'Sumali',
    disasters_nav_btn:'🌋 Mga Natural na Sakuna',
    weather_nav_btn:'⛅ Panahon', checklist_nav_btn:'✅ Listahan ng Paghahanda',
    back_menu:'← Bumalik sa Menu', back_results:'← Mga Resulta',
    checklist_title:'✅ Listahan ng Paghahanda',
    checklist_subtitle:'Iniayon sa mga panganib sa iyong rehiyon · lagyan ng tsek ang mga aytem habang nag-aayos ng kit',
    overall_prep:'Pangkalahatang Paghahanda',
    weather_title:'⛅ Kasalukuyang Panahon', wind_speed:'Bilis ng Hangin', precipitation:'Pag-ulan', feels_like:'Pakiramdam',
    share_btn:'🔗 Ibahagi', save_report_btn:'💾 I-save ang Ulat',
    no_events:'Walang makabuluhang pangyayari na natukoy sa rehiyong ito para sa napiling panahon.',
    weighted_event:'may timbang na pangyayari', weighted_events:'may timbang na mga pangyayari',
    conf_high:'Mataas na kumpiyansa', conf_med:'Katamtamang kumpiyansa', conf_low:'Mababang kumpiyansa',
    universal_name:'Universal na Pangunahing Pangangailangan', universal_reason:'Naaangkop sa lahat ng uri ng emergency', reset_btn:'↺ I-reset',
    risk_earthquake:'Lindol', risk_wildfire:'Sunog sa Kagubatan', risk_flood:'Baha', risk_volcano:'Bulkan',
    risk_storm:'Matinding Bagyo', risk_drought:'Tagtuyot', risk_tornado:'Tornado', risk_hurricane:'Bagyo',
    risk_winter_storm:'Bagyo sa Taglamig', risk_extreme_heat:'Matinding Init', risk_severe_weather:'Mapanganib na Panahon',
    wmo_0:'Maliwanag', wmo_1:'Karamihang Maliwanag', wmo_2:'Bahagyang Maulap', wmo_3:'Maulap',
    wmo_fog:'Ulap sa Lupa', wmo_drizzle:'Ambon', wmo_rain:'Ulan', wmo_snow:'Niyebe',
    wmo_rain_showers:'Malakas na Ulan', wmo_snow_showers:'Pagbagsak ng Niyebe', wmo_thunderstorm:'Bagyo na may Kidlat',
    ck_earthquake_reason:'Batay sa sismikong aktibidad na natukoy sa iyong lugar',
    ck_wildfire_reason:'Natukoy ang mga sunog sa kagubatan sa iyong rehiyon',
    ck_flood_reason:'Natukoy ang baha malapit sa iyong rehiyon',
    ck_volcano_reason:'Natukoy ang aktibidad ng bulkan malapit sa iyong rehiyon',
    ck_winter_storm_reason:'Natukoy ang panganib sa bagyo sa taglamig o mga babala',
    ck_hurricane_reason:'Natukoy ang panganib sa bagyo o mga babala',
    ck_tornado_reason:'Natukoy ang panganib sa tornado o mga babala',
    ck_extreme_heat_reason:'Aktibong babala sa matinding init sa rehiyon',
    ck_storm_reason:'Natukoy ang mga pangyayari ng bagyo sa rehiyon',
    ck_drought_reason:'Natukoy ang kondisyon ng tagtuyot sa rehiyon',
    ck_severe_weather_reason:'Pangkalahatang panganib sa mapanganib na panahon para sa rehiyong ito',
    lp_slogan:'Ang iyong rehiyon. Ang iyong mga panganib. Ang iyong plano.',
    lp_sub:'Real-time na datos ng sakuna, personalisadong pagsusuri ng panganib, at mga kasangkapan sa paghahanda — para sa iyong eksaktong lokasyon, libre.',
    lp_cta_start:'Magsimula →', lp_no_bs:'Hindi kailangan ng account · Laging libre',
    lp_source_label:'Live na datos mula sa', lp_section_tag:'Bakit kami',
    lp_section_title:'Hindi isa pang pangkaraniwang emergency na app',
    lp_section_sub:'Karamihang app ay nagpapakita ng mga pambansang balita. Sinusuri namin ang nangyayari sa loob ng 400 km mula sa iyong eksaktong address.',
    lp_panel1_title:'Live na Datos ng Sakuna',
    lp_panel1_desc:'Kumukuha ng datos ng lindol mula USGS, natural na pangyayari mula NASA EONET, at mga aktibong babala sa panahon mula NWS nang real-time.',
    lp_panel2_title:'Hyper-Local na Pagsusuri ng Panganib',
    lp_panel2_desc:'Ang mga pangyayari sa loob ng 400 km mula sa iyong mga coordinate ay inayos ayon sa dalas at bigat ng kalubhaan.',
    lp_panel3_title:'Personalisadong Mga Listahan',
    lp_panel3_desc:'Ang iyong listahan ng paghahanda ay ginawa mula sa iyong rehiyonal na profile ng panganib. Sona ng lindol? Makakakuha ka ng mga aytem para sa lindol.',
    lp_panel4_title:'Edukasyon sa Sakuna',
    lp_panel4_desc:'Detalyadong gabay para sa 12 uri ng natural na sakuna — mga sanhi, mga senyales ng babala, at kung ano ang dapat gawin sa panahon at pagkatapos.',
    lp_panel5_title:'Panahon at Mga Aktibong Babala',
    lp_panel5_desc:'Kasalukuyang kondisyon ng panahon at mga emergency na babala ng NWS nang live, kasama ang interactive na mapa ng makasaysayang sakuna.',
    lp_panel6_title:'Tracker ng Pamilya',
    lp_panel6_desc:'Lumikha ng mga pangkat ng pamilya, subaybayan ang pag-unlad ng paghahanda ng bawat miyembro, at mag-sync nang real-time sa pagitan ng mga device.',
    lp_bottom_title:'Handa na bang makita kung ano ang nangyayari sa iyong rehiyon?',
    lp_bottom_sub:'I-type lang ang iyong lungsod. Hindi hihigit sa 10 segundo.',
    lp_bottom_cta:'Tingnan ang Aking Rehiyon →', scroll_hint:'Mag-scroll para sa higit pa', home_btn:'🏠 Home',
  },
  nl: {
    lang_name:'NL', header_subtitle:'Realtime rampbewaking en voorbereidingslijst',
    search_label:'Zoek uw regio', search_placeholder:'Stad, provincie of postcode…',
    search_btn:'Zoeken', geo_btn:'📍 Gebruik mijn locatie',
    empty_title:'Zoek uw regio om te beginnen',
    empty_msg:'Voer een stad in of gebruik uw locatie om recente rampen,<br>risicoanalyse en een gepersonaliseerde voorbereidingslijst te bekijken.',
    loading_title:'Regionale gegevens laden…',
    loading_msg:'USGS aardbevingen, NASA EONET-gebeurtenissen<br>en NWS-weerwaarschuwingen opvragen',
    map_title:'🗺️ Gebeurtenissenkaart', time_machine:'⏱ Tijdmachine', all_time:'Alle tijd',
    play:'▶ Afspelen', pause:'⏸ Pauzeren',
    stat_quakes:'Aardbevingen', stat_fires:'Branden', stat_floods:'Overstromingen', stat_alerts:'Waarschuwingen',
    risks_title:'⚠️ Belangrijkste Regionale Risico\'s',
    day_btn:'Dag', week_btn:'Week', month_btn:'Maand', yr_unit:'jaar',
    tracker_title:'👨‍👩‍👧 Gezinsvolger',
    family_placeholder:'Naam nieuwe groep…', add_family_btn:'+ Gezin',
    join_placeholder:'Voer code in om deel te nemen…', join_btn:'Deelnemen',
    disasters_nav_btn:'🌋 Natuurrampen',
    weather_nav_btn:'⛅ Weer', checklist_nav_btn:'✅ Voorbereidingslijst',
    back_menu:'← Terug naar menu', back_results:'← Resultaten',
    checklist_title:'✅ Voorbereidingslijst',
    checklist_subtitle:'Afgestemd op uw regionale risico\'s · vink items aan terwijl u uw kit samenstelt',
    overall_prep:'Algehele Voorbereiding',
    weather_title:'⛅ Huidig Weer', wind_speed:'Windsnelheid', precipitation:'Neerslag', feels_like:'Voelt als',
    share_btn:'🔗 Delen', save_report_btn:'💾 Rapport opslaan',
    no_events:'Geen significante gebeurtenissen gedetecteerd in deze regio voor de geselecteerde periode.',
    weighted_event:'gewogen gebeurtenis', weighted_events:'gewogen gebeurtenissen',
    conf_high:'Hoog vertrouwen', conf_med:'Gemiddeld vertrouwen', conf_low:'Laag vertrouwen',
    universal_name:'Universele Essentials', universal_reason:'Van toepassing op alle soorten noodsituaties', reset_btn:'↺ Resetten',
    risk_earthquake:'Aardbeving', risk_wildfire:'Bosbrand', risk_flood:'Overstroming', risk_volcano:'Vulkaan',
    risk_storm:'Zware Storm', risk_drought:'Droogte', risk_tornado:'Tornado', risk_hurricane:'Orkaan',
    risk_winter_storm:'Winterstorm', risk_extreme_heat:'Extreme Hitte', risk_severe_weather:'Zwaar Weer',
    wmo_0:'Heldere Lucht', wmo_1:'Overwegend Helder', wmo_2:'Gedeeltelijk Bewolkt', wmo_3:'Bewolkt',
    wmo_fog:'Mist', wmo_drizzle:'Motregen', wmo_rain:'Regen', wmo_snow:'Sneeuw',
    wmo_rain_showers:'Regenbuien', wmo_snow_showers:'Sneeuwbuien', wmo_thunderstorm:'Onweer',
    ck_earthquake_reason:'Gebaseerd op seismische activiteit gedetecteerd in uw gebied',
    ck_wildfire_reason:'Bosbranden gedetecteerd in uw regio',
    ck_flood_reason:'Overstromingen gedetecteerd nabij uw regio',
    ck_volcano_reason:'Vulkanische activiteit gedetecteerd nabij uw regio',
    ck_winter_storm_reason:'Winterstormrisico of waarschuwingen gedetecteerd',
    ck_hurricane_reason:'Orkaan risico of waarschuwingen gedetecteerd',
    ck_tornado_reason:'Tornado risico of waarschuwingen gedetecteerd',
    ck_extreme_heat_reason:'Extreme hitte waarschuwingen actief in de regio',
    ck_storm_reason:'Storm gebeurtenissen gedetecteerd in de regio',
    ck_drought_reason:'Droogte condities gedetecteerd in de regio',
    ck_severe_weather_reason:'Algemeen zwaar weer risico voor deze regio',
    lp_slogan:'Uw regio. Uw risico\'s. Uw plan.',
    lp_sub:'Realtime rampgegevens, gepersonaliseerde risicoanalyse en voorbereidingstools — gebouwd voor uw exacte locatie, gratis.',
    lp_cta_start:'Beginnen →', lp_no_bs:'Geen account nodig · Altijd gratis',
    lp_source_label:'Live data van', lp_section_tag:'Waarom wij',
    lp_section_title:'Niet weer een generieke noodapp',
    lp_section_sub:'De meeste apps tonen nationale nieuws. Wij analyseren wat er gebeurt binnen 400 km van uw exacte adres.',
    lp_panel1_title:'Live Rampgegevens',
    lp_panel1_desc:'Haalt aardbevingsgegevens op van USGS, natuurlijke gebeurtenissen van NASA EONET en weerwaarschuwingen van NWS in realtime.',
    lp_panel2_title:'Hyper-Lokale Risicoanalyse',
    lp_panel2_desc:'Gebeurtenissen binnen 400 km van uw exacte coördinaten worden gerangschikt op frequentie en gewogen ernst.',
    lp_panel3_title:'Gepersonaliseerde Checklists',
    lp_panel3_desc:'Uw voorbereidingslijst is gebaseerd op uw regionaal risicoprofiel. Aardbevingszone? U krijgt aardbeving-items.',
    lp_panel4_title:'Rampeneducatie',
    lp_panel4_desc:'Gedetailleerde gidsen voor 12 soorten natuurrampen — oorzaken, waarschuwingssignalen, wat te doen tijdens en na.',
    lp_panel5_title:'Weer en Actieve Waarschuwingen',
    lp_panel5_desc:'Huidige weersomstandigheden en live NWS-noodwaarschuwingen voor uw gebied, plus interactieve kaart.',
    lp_panel6_title:'Gezinsvolger',
    lp_panel6_desc:'Maak gezinsgroepen aan, volg de voorbereidingsvoortgang van elk lid en synchroniseer realtime tussen apparaten.',
    lp_bottom_title:'Klaar om te zien wat er in uw regio gebeurt?',
    lp_bottom_sub:'Voer gewoon uw stad in. Duurt minder dan 10 seconden.',
    lp_bottom_cta:'Zie Mijn Regio →', scroll_hint:'Scroll voor meer', home_btn:'🏠 Home',
  },
  sw: {
    lang_name:'SW', header_subtitle:'Ufuatiliaji wa maafa wa wakati halisi na orodha ya maandalizi',
    search_label:'Tafuta eneo lako', search_placeholder:'Jiji, mkoa, au nambari ya posta…',
    search_btn:'Tafuta', geo_btn:'📍 Tumia Mahali Pangu',
    empty_title:'Tafuta eneo lako kuanza',
    empty_msg:'Ingiza jiji au tumia mahali pako kuona matukio ya hivi karibuni,<br>uchambuzi wa hatari na orodha ya maandalizi ya kibinafsi.',
    loading_title:'Inapakia data ya mkoa…',
    loading_msg:'Inachunguza matetemeko USGS, matukio ya NASA EONET<br>na tahadhari za hali ya hewa NWS',
    map_title:'🗺️ Ramani ya Matukio', time_machine:'⏱ Mashine ya Wakati', all_time:'Wakati wote',
    play:'▶ Cheza', pause:'⏸ Simama',
    stat_quakes:'Matetemeko', stat_fires:'Moto', stat_floods:'Mafuriko', stat_alerts:'Tahadhari',
    risks_title:'⚠️ Hatari Kuu za Mkoa',
    day_btn:'Siku', week_btn:'Wiki', month_btn:'Mwezi', yr_unit:'mwaka',
    tracker_title:'👨‍👩‍👧 Kifuatiliaji cha Familia',
    family_placeholder:'Jina la kikundi kipya…', add_family_btn:'+ Familia',
    join_placeholder:'Ingiza nambari ya kujiunga…', join_btn:'Jiunge',
    disasters_nav_btn:'🌋 Maafa ya Asili',
    weather_nav_btn:'⛅ Hali ya Hewa', checklist_nav_btn:'✅ Orodha ya Maandalizi',
    back_menu:'← Rudi Menyu', back_results:'← Matokeo',
    checklist_title:'✅ Orodha ya Maandalizi',
    checklist_subtitle:'Iliyobinafsishwa kwa hatari zako za mkoa · angalia vitu unapotayarisha vifaa vyako',
    overall_prep:'Maandalizi ya Jumla',
    weather_title:'⛅ Hali ya Hewa ya Sasa', wind_speed:'Kasi ya Upepo', precipitation:'Mvua', feels_like:'Inahisi kama',
    share_btn:'🔗 Shiriki', save_report_btn:'💾 Hifadhi Ripoti',
    no_events:'Hakuna matukio makubwa yaliyogunduliwa katika mkoa huu kwa kipindi kilichochaguliwa.',
    weighted_event:'tukio lenye uzito', weighted_events:'matukio yenye uzito',
    conf_high:'Imani ya juu', conf_med:'Imani ya wastani', conf_low:'Imani ya chini',
    universal_name:'Mahitaji ya Msingi ya Ulimwengu', universal_reason:'Inatumika kwa aina zote za dharura', reset_btn:'↺ Rejesha',
    risk_earthquake:'Tetemeko la Ardhi', risk_wildfire:'Moto wa Misitu', risk_flood:'Mafuriko', risk_volcano:'Volkeno',
    risk_storm:'Dhoruba Kali', risk_drought:'Ukame', risk_tornado:'Kimbunga', risk_hurricane:'Tufani',
    risk_winter_storm:'Dhoruba ya Majira ya Baridi', risk_extreme_heat:'Joto Kali', risk_severe_weather:'Hali Mbaya ya Hewa',
    wmo_0:'Anga Safi', wmo_1:'Wazi Zaidi', wmo_2:'Mawingu Kidogo', wmo_3:'Mawingu Mengi',
    wmo_fog:'Ukungu', wmo_drizzle:'Mvua Nyepesi', wmo_rain:'Mvua', wmo_snow:'Theluji',
    wmo_rain_showers:'Mvua ya Ghafla', wmo_snow_showers:'Mvua ya Theluji', wmo_thunderstorm:'Radi na Mvua',
    ck_earthquake_reason:'Kulingana na shughuli za seismiki zilizogunduliwa katika eneo lako',
    ck_wildfire_reason:'Moto wa misitu uligunduliwa katika mkoa wako',
    ck_flood_reason:'Mafuriko yaligunduliwa karibu na mkoa wako',
    ck_volcano_reason:'Shughuli za volkeno ziligunduliwa karibu na mkoa wako',
    ck_winter_storm_reason:'Hatari ya dhoruba ya baridi au tahadhari ziligunduliwa',
    ck_hurricane_reason:'Hatari ya tufani au tahadhari ziligunduliwa',
    ck_tornado_reason:'Hatari ya kimbunga au tahadhari ziligunduliwa',
    ck_extreme_heat_reason:'Tahadhari za joto kali zinafanya kazi katika mkoa',
    ck_storm_reason:'Matukio ya dhoruba yaligunduliwa katika mkoa',
    ck_drought_reason:'Hali ya ukame iligunduliwa katika mkoa',
    ck_severe_weather_reason:'Hatari ya jumla ya hali mbaya ya hewa kwa mkoa huu',
    lp_slogan:'Mkoa wako. Hatari zako. Mpango wako.',
    lp_sub:'Data ya maafa ya wakati halisi, uchambuzi wa hatari wa kibinafsi na zana za maandalizi — zilizojengwa kwa mahali pako halisi, bure.',
    lp_cta_start:'Anza →', lp_no_bs:'Hakuna akaunti inayohitajika · Bure milele',
    lp_source_label:'Data ya moja kwa moja kutoka', lp_section_tag:'Kwa nini sisi',
    lp_section_title:'Si programu nyingine ya kawaida ya dharura',
    lp_section_sub:'Programu nyingi zinaonyesha habari za kitaifa. Sisi tunachunguza kinachoendelea ndani ya kilomita 400 kutoka anwani yako halisi.',
    lp_panel1_title:'Data ya Maafa ya Moja kwa Moja',
    lp_panel1_desc:'Inapata data ya matetemeko kutoka USGS, matukio ya asili kutoka NASA EONET na tahadhari za hali ya hewa kutoka NWS kwa wakati halisi.',
    lp_panel2_title:'Uchambuzi wa Hatari wa Karibu Sana',
    lp_panel2_desc:'Matukio ndani ya kilomita 400 kutoka koordineti zako yanaorodheshwa kwa mzunguko na ukali wenye uzito.',
    lp_panel3_title:'Orodha za Kubinafsishwa',
    lp_panel3_desc:'Orodha yako ya maandalizi imejengwa kutoka wasifu wako wa hatari za mkoa. Eneo la matetemeko? Unapata vitu vya matetemeko.',
    lp_panel4_title:'Elimu ya Maafa',
    lp_panel4_desc:'Miongozo ya kina kwa aina 12 za maafa ya asili — sababu, ishara za onyo, nini cha kufanya wakati na baada ya tukio.',
    lp_panel5_title:'Hali ya Hewa na Tahadhari Zinazofanya Kazi',
    lp_panel5_desc:'Hali ya hewa ya sasa na tahadhari za dharura za NWS kwa moja kwa moja, pamoja na ramani inayoingiliana ya maafa ya kihistoria.',
    lp_panel6_title:'Kifuatiliaji cha Familia',
    lp_panel6_desc:'Unda vikundi vya familia, fuatilia maendeleo ya maandalizi ya kila mwanachama na usawazishe kwa wakati halisi kati ya vifaa.',
    lp_bottom_title:'Uko tayari kuona kinachoendelea katika mkoa wako?',
    lp_bottom_sub:'Ingiza tu jiji lako. Inachukua chini ya sekunde 10.',
    lp_bottom_cta:'Angalia Mkoa Wangu →', scroll_hint:'Sogeza chini kwa zaidi', home_btn:'🏠 Nyumbani',
  },
  th: {
    lang_name:'TH', header_subtitle:'การติดตามภัยพิบัติแบบเรียลไทม์และรายการเตรียมพร้อม',
    search_label:'ค้นหาพื้นที่ของคุณ', search_placeholder:'เมือง จังหวัด หรือรหัสไปรษณีย์…',
    search_btn:'ค้นหา', geo_btn:'📍 ใช้ตำแหน่งของฉัน',
    empty_title:'ค้นหาพื้นที่ของคุณเพื่อเริ่มต้น',
    empty_msg:'พิมพ์ชื่อเมืองหรือใช้ตำแหน่งของคุณเพื่อดูเหตุการณ์ล่าสุด<br>การวิเคราะห์ความเสี่ยง และรายการเตรียมพร้อมส่วนตัว',
    loading_title:'กำลังโหลดข้อมูลพื้นที่…',
    loading_msg:'กำลังสืบค้นแผ่นดินไหว USGS เหตุการณ์ NASA EONET<br>และคำเตือนสภาพอากาศ NWS',
    map_title:'🗺️ แผนที่เหตุการณ์', time_machine:'⏱ เครื่องย้อนเวลา', all_time:'ตลอดเวลา',
    play:'▶ เล่น', pause:'⏸ หยุดชั่วคราว',
    stat_quakes:'แผ่นดินไหว', stat_fires:'ไฟป่า', stat_floods:'น้ำท่วม', stat_alerts:'การเตือน',
    risks_title:'⚠️ ความเสี่ยงหลักในพื้นที่',
    day_btn:'วัน', week_btn:'สัปดาห์', month_btn:'เดือน', yr_unit:'ปี',
    tracker_title:'👨‍👩‍👧 ตัวติดตามครอบครัว',
    family_placeholder:'ชื่อกลุ่มใหม่…', add_family_btn:'+ ครอบครัว',
    join_placeholder:'ใส่รหัสเพื่อเข้าร่วม…', join_btn:'เข้าร่วม',
    disasters_nav_btn:'🌋 ภัยพิบัติธรรมชาติ',
    weather_nav_btn:'⛅ สภาพอากาศ', checklist_nav_btn:'✅ รายการเตรียมพร้อม',
    back_menu:'← กลับเมนู', back_results:'← ผลลัพธ์',
    checklist_title:'✅ รายการเตรียมพร้อม',
    checklist_subtitle:'ปรับแต่งตามความเสี่ยงในพื้นที่ · ทำเครื่องหมายรายการขณะเตรียมชุดอุปกรณ์',
    overall_prep:'ความพร้อมโดยรวม',
    weather_title:'⛅ สภาพอากาศปัจจุบัน', wind_speed:'ความเร็วลม', precipitation:'ปริมาณน้ำฝน', feels_like:'รู้สึกเหมือน',
    share_btn:'🔗 แชร์', save_report_btn:'💾 บันทึกรายงาน',
    no_events:'ไม่พบเหตุการณ์สำคัญในพื้นที่นี้สำหรับช่วงเวลาที่เลือก',
    weighted_event:'เหตุการณ์แบบถ่วงน้ำหนัก', weighted_events:'เหตุการณ์แบบถ่วงน้ำหนัก',
    conf_high:'ความเชื่อมั่นสูง', conf_med:'ความเชื่อมั่นปานกลาง', conf_low:'ความเชื่อมั่นต่ำ',
    universal_name:'สิ่งจำเป็นสากล', universal_reason:'ใช้ได้กับทุกประเภทฉุกเฉิน', reset_btn:'↺ รีเซ็ต',
    risk_earthquake:'แผ่นดินไหว', risk_wildfire:'ไฟป่า', risk_flood:'น้ำท่วม', risk_volcano:'ภูเขาไฟ',
    risk_storm:'พายุรุนแรง', risk_drought:'ภัยแล้ง', risk_tornado:'ทอร์นาโด', risk_hurricane:'เฮอร์ริเคน',
    risk_winter_storm:'พายุหิมะ', risk_extreme_heat:'ความร้อนสุดขีด', risk_severe_weather:'สภาพอากาศเลวร้าย',
    wmo_0:'ท้องฟ้าแจ่มใส', wmo_1:'ส่วนใหญ่แจ่มใส', wmo_2:'มีเมฆบางส่วน', wmo_3:'มืดครึ้ม',
    wmo_fog:'หมอก', wmo_drizzle:'ฝนปรอยๆ', wmo_rain:'ฝน', wmo_snow:'หิมะ',
    wmo_rain_showers:'ฝนตกหนัก', wmo_snow_showers:'หิมะตก', wmo_thunderstorm:'พายุฝนฟ้าคะนอง',
    ck_earthquake_reason:'อ้างอิงจากกิจกรรมแผ่นดินไหวที่ตรวจพบในพื้นที่ของคุณ',
    ck_wildfire_reason:'ตรวจพบไฟป่าในพื้นที่ของคุณ',
    ck_flood_reason:'ตรวจพบน้ำท่วมใกล้พื้นที่ของคุณ',
    ck_volcano_reason:'ตรวจพบกิจกรรมภูเขาไฟใกล้พื้นที่ของคุณ',
    ck_winter_storm_reason:'ตรวจพบความเสี่ยงพายุหิมะหรือคำเตือน',
    ck_hurricane_reason:'ตรวจพบความเสี่ยงเฮอร์ริเคนหรือคำเตือน',
    ck_tornado_reason:'ตรวจพบความเสี่ยงทอร์นาโดหรือคำเตือน',
    ck_extreme_heat_reason:'คำเตือนความร้อนสุดขีดใช้งานอยู่ในพื้นที่',
    ck_storm_reason:'ตรวจพบเหตุการณ์พายุในพื้นที่',
    ck_drought_reason:'ตรวจพบสภาวะแล้งในพื้นที่',
    ck_severe_weather_reason:'ความเสี่ยงสภาพอากาศเลวร้ายทั่วไปสำหรับพื้นที่นี้',
    lp_slogan:'พื้นที่ของคุณ ความเสี่ยงของคุณ แผนของคุณ',
    lp_sub:'ข้อมูลภัยพิบัติแบบเรียลไทม์ การวิเคราะห์ความเสี่ยงส่วนตัว และเครื่องมือเตรียมพร้อม — สร้างขึ้นรอบตำแหน่งแน่นอนของคุณ ฟรี',
    lp_cta_start:'เริ่มต้น →', lp_no_bs:'ไม่ต้องมีบัญชี · ฟรีตลอดไป',
    lp_source_label:'ข้อมูลสดจาก', lp_section_tag:'ทำไมต้องเลือกเรา',
    lp_section_title:'ไม่ใช่แอปฉุกเฉินทั่วไปอีกตัว',
    lp_section_sub:'แอปส่วนใหญ่แสดงข่าวระดับชาติ เราวิเคราะห์สิ่งที่เกิดขึ้นภายใน 400 กม. จากที่อยู่แน่นอนของคุณ',
    lp_panel1_title:'ข้อมูลภัยพิบัติสด',
    lp_panel1_desc:'ดึงข้อมูลแผ่นดินไหวจาก USGS เหตุการณ์ธรรมชาติจาก NASA EONET และคำเตือนสภาพอากาศจาก NWS แบบเรียลไทม์',
    lp_panel2_title:'การวิเคราะห์ความเสี่ยงระดับท้องถิ่นสูงสุด',
    lp_panel2_desc:'เหตุการณ์ภายใน 400 กม. จากพิกัดแน่นอนของคุณถูกจัดอันดับตามความถี่และความรุนแรงแบบถ่วงน้ำหนัก',
    lp_panel3_title:'รายการตรวจสอบส่วนตัว',
    lp_panel3_desc:'รายการเตรียมพร้อมสร้างจากโปรไฟล์ความเสี่ยงในพื้นที่ของคุณ โซนแผ่นดินไหว? คุณได้รับรายการแผ่นดินไหว',
    lp_panel4_title:'การศึกษาด้านภัยพิบัติ',
    lp_panel4_desc:'คู่มือโดยละเอียดสำหรับภัยพิบัติธรรมชาติ 12 ประเภท — สาเหตุ สัญญาณเตือน และสิ่งที่ต้องทำระหว่างและหลังเกิดเหตุ',
    lp_panel5_title:'สภาพอากาศและการเตือนที่ใช้งานอยู่',
    lp_panel5_desc:'สภาพอากาศปัจจุบันและการเตือนฉุกเฉิน NWS สด บวกแผนที่เชิงโต้ตอบสำหรับดูภัยพิบัติในอดีต',
    lp_panel6_title:'ตัวติดตามครอบครัว',
    lp_panel6_desc:'สร้างกลุ่มครอบครัว ติดตามความคืบหน้าการเตรียมพร้อมของสมาชิกแต่ละคน และซิงค์แบบเรียลไทม์ระหว่างอุปกรณ์',
    lp_bottom_title:'พร้อมดูสิ่งที่เกิดขึ้นในพื้นที่ของคุณหรือยัง?',
    lp_bottom_sub:'แค่พิมพ์ชื่อเมืองของคุณ ใช้เวลาไม่ถึง 10 วินาที',
    lp_bottom_cta:'ดูพื้นที่ของฉัน →', scroll_hint:'เลื่อนลงเพื่อดูเพิ่มเติม', home_btn:'🏠 หน้าหลัก',
  },
};

function t(key) {
  const lang = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  if (key in lang) return lang[key];
  if (key in TRANSLATIONS.en) return TRANSLATIONS.en[key];
  return undefined;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t(el.dataset.i18n); if (v !== undefined) el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const v = t(el.dataset.i18nHtml); if (v !== undefined) el.innerHTML = v;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const v = t(el.dataset.i18nPh); if (v !== undefined) el.placeholder = v;
  });
  const backBtn = document.getElementById('backBtn');
  if (backBtn && !backBtn.classList.contains('hidden')) {
    backBtn.textContent = (currentState === 'main') ? t('back_menu') : t('back_results');
  }
  const langBtn = document.getElementById('langPickerBtn');
  if (langBtn) langBtn.textContent = '🌐 ' + t('lang_name');
  document.querySelectorAll('.lang-option').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === currentLang));
  document.documentElement.lang = currentLang;
  if (currentRisks.length) { renderRisks(currentRisks); renderChecklist(currentRisks); }
  if (weatherData) renderWeather(weatherData);
  renderTracker();
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('mrr_lang', lang);
  document.getElementById('langMenu').classList.add('hidden');
  applyTranslations();
}

function toggleLangMenu() {
  document.getElementById('langMenu').classList.toggle('hidden');
}

document.addEventListener('click', e => {
  const langPicker = document.getElementById('langPicker');
  if (langPicker && !langPicker.contains(e.target))
    document.getElementById('langMenu').classList.add('hidden');
  const themePicker = document.getElementById('themePicker');
  if (themePicker && !themePicker.contains(e.target))
    document.getElementById('themeDrop')?.classList.add('hidden');
});

// ── Profanity filter ──────────────────────────────────────────────────────────
const _PROFANITY_RE = /\b(ass(?:hole|wipe|hat|face|clown)?|bastard|bitch\w*|cock\w*|cunt\w*|dick(?:head)?\b|fag(?:got)?\w*|fuck\w*|nigga\w*|nigger\w*|prick|pussy|shit\w*|slut\w*|tit(?:s|ty)?\b|twat|wank\w*|whore\w*)\b/i;

function hasProfanity(str) {
  const s = str.toLowerCase()
    .replace(/1/g,'i').replace(/3/g,'e').replace(/4/g,'a')
    .replace(/0/g,'o').replace(/5/g,'s').replace(/@/g,'a').replace(/\$/g,'s');
  return _PROFANITY_RE.test(s);
}

function showInputWarn(inputId, msg) {
  document.getElementById(inputId + 'Warn').textContent = '⚠️ ' + msg;
  document.getElementById(inputId + 'Warn').style.display = 'block';
}
function hideInputWarn(inputId) {
  const el = document.getElementById(inputId + 'Warn');
  if (el) el.style.display = 'none';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = x => x * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon/2)**2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let currentState = 'landing';

function showState(which) {
  currentState = which;
  ['emptyState','loadingState','errorState','mainContent','shareRow','checklistPage','weatherPage','disastersPage','landingPage'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  const searchSection = document.getElementById('searchSection');
  const backBtn = document.getElementById('backBtn');
  const homeBtn = document.getElementById('homeBtn');
  const checklistBtn = document.getElementById('checklistBtn');
  const weatherBtn  = document.getElementById('weatherBtn');
  const disastersBtn = document.getElementById('disastersBtn');
  if (which === 'landing') {
    document.getElementById('landingPage').classList.remove('hidden');
    if (searchSection) searchSection.classList.add('hidden');
    backBtn.classList.add('hidden');
    homeBtn?.classList.add('hidden');
    checklistBtn.classList.add('hidden');
    weatherBtn.classList.add('hidden');
    disastersBtn?.classList.add('hidden');
    return;
  }
  homeBtn?.classList.remove('hidden');
  if (searchSection) searchSection.classList.remove('hidden');
  if (which === 'main') {
    document.getElementById('mainContent').classList.remove('hidden');
    document.getElementById('shareRow').classList.remove('hidden');
    backBtn.textContent = t('back_menu');
    backBtn.classList.remove('hidden');
    checklistBtn.classList.remove('hidden');
    weatherBtn.classList.remove('hidden');
    disastersBtn?.classList.remove('hidden');
  } else if (which === 'checklist') {
    document.getElementById('checklistPage').classList.remove('hidden');
    backBtn.textContent = t('back_results');
    backBtn.classList.remove('hidden');
    checklistBtn.classList.add('hidden');
    weatherBtn.classList.add('hidden');
    disastersBtn?.classList.remove('hidden');
  } else if (which === 'weather') {
    document.getElementById('weatherPage').classList.remove('hidden');
    backBtn.textContent = t('back_results');
    backBtn.classList.remove('hidden');
    checklistBtn.classList.add('hidden');
    weatherBtn.classList.add('hidden');
    disastersBtn?.classList.remove('hidden');
  } else if (which === 'disasters') {
    document.getElementById('disastersPage').classList.remove('hidden');
    backBtn.textContent = currentLocation ? t('back_results') : t('back_menu');
    backBtn.classList.remove('hidden');
    checklistBtn.classList.add('hidden');
    weatherBtn.classList.add('hidden');
    disastersBtn?.classList.add('hidden');
  } else {
    document.getElementById(which + 'State').classList.remove('hidden');
    backBtn.classList.add('hidden');
    checklistBtn.classList.add('hidden');
    weatherBtn.classList.add('hidden');
    disastersBtn?.classList.remove('hidden');
  }
}

function backToLanding() {
  const toFade = ['mainContent','shareRow','checklistPage','weatherPage','disastersPage','searchSection','emptyState','loadingState','locationPill'];
  fadeOutThen(toFade, () => {
    showState('landing');
    const hint = document.getElementById('scrollHint');
    if (hint) hint.classList.remove('faded');
    enterPage('landingPage', 'page-enter-left');
  });
}

function fadeOutThen(ids, callback) {
  const els = ids.map(id => document.getElementById(id)).filter(el => el && !el.classList.contains('hidden'));
  let pending = els.length;
  if (!pending) { callback(); return; }
  els.forEach(el => {
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.addEventListener('transitionend', function h() {
      el.removeEventListener('transitionend', h);
      el.style.transition = '';
      el.style.opacity = '';
      el.style.transform = '';
      if (--pending === 0) callback();
    });
  });
}

function enterPage(id, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function showChecklistPage() {
  fadeOutThen(['mainContent', 'shareRow'], () => {
    showState('checklist');
    enterPage('checklistPage', 'page-enter-right');
  });
}

function enterApp() {
  fadeOutThen(['landingPage'], () => {
    showState('empty');
    const s = document.getElementById('searchSection');
    const e = document.getElementById('emptyState');
    [s, e].forEach(el => {
      if (!el) return;
      el.classList.add('fade-in');
      el.addEventListener('animationend', () => el.classList.remove('fade-in'), { once: true });
    });
  });
}

function showDisastersPage() {
  fadeOutThen(['mainContent','shareRow','emptyState','loadingState','errorState','checklistPage','weatherPage','landingPage'], () => {
    showState('disasters');
    renderDisasterGrid();
    document.getElementById('disasterDetail').classList.add('hidden');
    document.getElementById('disasterGrid').classList.remove('hidden');
    enterPage('disastersPage', 'page-enter-right');
  });
}

function renderDisasterGrid() {
  document.getElementById('disasterGrid').innerHTML = `
    <div class="dis-grid">
      ${DISASTERS.map(d => `
        <div class="dis-card" style="border-left-color:${d.color}" onclick="showDisasterDetail('${d.type}')">
          <div class="dis-icon">${d.icon}</div>
          <div class="dis-name" style="color:${d.color}">${d.name}</div>
          <div class="dis-tagline">${d.tagline}</div>
        </div>
      `).join('')}
    </div>`;
}

function showDisasterDetail(type) {
  const d = DISASTERS.find(x => x.type === type);
  if (!d) return;
  const grid = document.getElementById('disasterGrid');
  const detail = document.getElementById('disasterDetail');
  grid.style.transition = 'opacity 0.2s';
  grid.style.opacity = '0';
  setTimeout(() => {
    grid.style.transition = '';
    grid.style.opacity = '';
    grid.classList.add('hidden');
    const sec = (title, items, color) => !items?.length ? '' : `
      <div class="dis-section">
        <div class="dis-section-title">${title}</div>
        <ul class="dis-list">${items.map(it =>
          `<li><span class="dis-bullet" style="color:${color}">•</span><span>${it}</span></li>`
        ).join('')}</ul>
      </div>`;
    detail.innerHTML = `
      <button class="dis-back" onclick="backToDisasterGrid()">← All Disasters</button>
      <div class="dis-banner" style="background:linear-gradient(135deg,${d.color}ee,${d.color}99);">
        <div class="dis-banner-icon">${d.icon}</div>
        <div class="dis-banner-name">${d.name}</div>
        <div class="dis-banner-tagline">${d.tagline}</div>
      </div>
      <div class="dis-meta">
        <div class="dis-meta-card"><div class="dis-meta-label">⚠️ Severity</div><div class="dis-meta-val">${d.severity}</div></div>
        <div class="dis-meta-card"><div class="dis-meta-label">⏱ Warning Time</div><div class="dis-meta-val">${d.speed}</div></div>
        <div class="dis-meta-card"><div class="dis-meta-label">📍 Scale</div><div class="dis-meta-val">${d.affected_area}</div></div>
      </div>
      <div class="dis-section">
        <div class="dis-section-title">📖 About</div>
        <p class="dis-desc">${d.description}</p>
      </div>
      ${sec('⚡ Causes', d.causes, '#ffd166')}
      ${sec('⚠️ Warning Signs', d.warning_signs, '#ef476f')}
      ${sec('🛡️ What to Do During', d.during, '#06d6a0')}
      ${sec('✅ What to Do After', d.after, '#4ecdc4')}
      ${sec('📊 Fast Facts', d.facts, 'var(--accent)')}`;
    detail.classList.remove('hidden');
    detail.style.opacity = '0';
    requestAnimationFrame(() => {
      detail.style.transition = 'opacity 0.25s';
      detail.style.opacity = '1';
      setTimeout(() => { detail.style.transition = ''; }, 280);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 200);
}

function backToDisasterGrid() {
  const grid = document.getElementById('disasterGrid');
  const detail = document.getElementById('disasterDetail');
  detail.style.transition = 'opacity 0.2s';
  detail.style.opacity = '0';
  setTimeout(() => {
    detail.style.transition = '';
    detail.style.opacity = '';
    detail.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.style.opacity = '0';
    requestAnimationFrame(() => {
      grid.style.transition = 'opacity 0.25s';
      grid.style.opacity = '1';
      setTimeout(() => { grid.style.transition = ''; }, 280);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 200);
}

function backToMenu() {
  if (currentState === 'checklist') {
    fadeOutThen(['checklistPage'], () => { showState('main'); enterPage('mainContent', 'page-enter-left'); });
    return;
  }
  if (currentState === 'weather') {
    fadeOutThen(['weatherPage'], () => { showState('main'); enterPage('mainContent', 'page-enter-left'); });
    return;
  }
  if (currentState === 'disasters') {
    const dest = currentLocation ? 'main' : 'empty';
    fadeOutThen(['disastersPage'], () => {
      showState(dest);
      if (dest === 'main') enterPage('mainContent', 'page-enter-left');
    });
    return;
  }
  const fadeTargets = ['mainContent', 'shareRow'].map(id => document.getElementById(id)).filter(el => !el.classList.contains('hidden'));
  let pending = fadeTargets.length;

  function finish() {
    showState('empty');
    document.getElementById('locationPill').classList.add('hidden');
    document.getElementById('cityInput').value = '';
    const empty = document.getElementById('emptyState');
    const search = document.querySelector('.search-section');
    empty.classList.add('fade-in');
    search.classList.add('fade-in');
    empty.addEventListener('animationend', () => empty.classList.remove('fade-in'), { once: true });
    search.addEventListener('animationend', () => search.classList.remove('fade-in'), { once: true });
  }

  if (!pending) { finish(); return; }

  fadeTargets.forEach(el => {
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.addEventListener('transitionend', function handler() {
      el.removeEventListener('transitionend', handler);
      el.style.transition = '';
      el.style.opacity = '';
      el.style.transform = '';
      if (--pending === 0) finish();
    });
  });
}

function showError(title, msg) {
  document.getElementById('errTitle').textContent = title;
  document.getElementById('errMsg').textContent = msg;
  showState('error');
}

// ── Geocoding (Nominatim) ─────────────────────────────────────────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (!data.length) throw new Error('Location not found — try a different city name.');
  const r = data[0];
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), name: r.display_name.split(',').slice(0, 3).join(', ') };
}

async function reverseGeocode(lat, lon) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
  const d = await res.json();
  return d.address?.city || d.address?.town || d.address?.county || 'Your Location';
}

// ── USGS Earthquakes ─────────────────────────────────────────────────────────
async function fetchUSGS(lat, lon, years = YEARS_BACK) {
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - years * 365.25 * 86400000).toISOString().split('T')[0];
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&endtime=${end}` +
    `&latitude=${lat}&longitude=${lon}&maxradiuskm=${RADIUS_KM}&minmagnitude=2.5&orderby=time&limit=500`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map(f => ({
    type: 'earthquake',
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    title: f.properties.title,
    mag: f.properties.mag,
    depth: f.geometry.coordinates[2],
    date: new Date(f.properties.time),
    year: new Date(f.properties.time).getFullYear(),
    url: f.properties.url,
  }));
}

// ── NASA EONET Natural Events ─────────────────────────────────────────────────
async function fetchEONET(lat, lon, years = YEARS_BACK) {
  const days = Math.round(years * 365);
  const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=${days}&limit=500`;
  const res = await fetch(url);
  const data = await res.json();
  const events = [];

  for (const ev of (data.events || [])) {
    let evLat = null, evLon = null;
    for (const g of (ev.geometry || [])) {
      if (g.type === 'Point') {
        [evLon, evLat] = g.coordinates;
        break;
      } else if (g.type === 'Polygon' && g.coordinates?.[0]?.length) {
        const pts = g.coordinates[0];
        evLon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        evLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        break;
      }
    }
    if (evLat === null || evLon === null) continue;
    if (haversineKm(lat, lon, evLat, evLon) > RADIUS_KM) continue;

    const catId = ev.categories?.[0]?.id || '';
    const typeMap = { wildfires: 'wildfire', floods: 'flood', volcanoes: 'volcano', severeStorms: 'storm', drought: 'drought' };
    const evType = typeMap[catId];
    if (!evType) continue;

    const dateStr = ev.geometry?.[0]?.date || ev.closed || null;
    const date = dateStr ? new Date(dateStr) : null;
    events.push({ type: evType, lat: evLat, lon: evLon, title: ev.title, date, year: date?.getFullYear() || null });
  }
  return events;
}

// ── NWS Active Alerts ─────────────────────────────────────────────────────────
async function fetchNWSAlerts(lat, lon) {
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MyRegionsRisk/1.0 (github.com/vDentro)' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(f => ({
      type: 'alert',
      event: f.properties.event,
      headline: f.properties.headline,
      severity: f.properties.severity,
      areas: f.properties.areaDesc,
      sent: new Date(f.properties.sent),
      lat, lon,
    }));
  } catch { return []; }
}

// ── Risk Analysis ─────────────────────────────────────────────────────────────
const RISK_META = {
  earthquake:   { name: 'Earthquake',    icon: '🌋', color: '#4ecdc4' },
  wildfire:     { name: 'Wildfire',       icon: '🔥', color: '#ff6b35' },
  flood:        { name: 'Flood',          icon: '🌊', color: '#6495ed' },
  volcano:      { name: 'Volcano',        icon: '🌋', color: '#ef476f' },
  storm:        { name: 'Severe Storm',   icon: '⛈️', color: '#ffd166' },
  drought:      { name: 'Drought',        icon: '☀️', color: '#f4a261' },
  tornado:      { name: 'Tornado',        icon: '🌪️', color: '#a8dadc' },
  hurricane:    { name: 'Hurricane',      icon: '🌀', color: '#219ebc' },
  winter_storm: { name: 'Winter Storm',   icon: '❄️', color: '#90e0ef' },
  extreme_heat: { name: 'Extreme Heat',   icon: '🌡️', color: '#e76f51' },
  severe_weather:{ name: 'Severe Weather',icon: '⛈️', color: '#ffd166' },
};

function analyzeRisks(earthquakes, naturalEvents, alerts, years = analysisYears) {
  const cutoff = new Date(Date.now() - years * 365.25 * 86400000);
  const recentCutoff = new Date(Date.now() - 365 * 86400000);

  const eqs  = earthquakes.filter(ev => !ev.date || ev.date >= cutoff);
  const natEvs = naturalEvents.filter(ev => !ev.date || ev.date >= cutoff);

  const scores = {};
  const add = (type, w) => scores[type] = (scores[type] || 0) + w;

  eqs.forEach(ev => {
    const mag = ev.mag >= 6 ? 3 : ev.mag >= 5 ? 2 : 1;
    add('earthquake', mag * (ev.date > recentCutoff ? 2 : 1));
  });

  natEvs.forEach(ev => add(ev.type, ev.date && ev.date > recentCutoff ? 2 : 1));

  alerts.forEach(a => {
    const e = (a.event || '').toLowerCase();
    if      (e.includes('fire'))                        add('wildfire', 5);
    else if (e.includes('flood'))                       add('flood', 5);
    else if (e.includes('tornado'))                     add('tornado', 5);
    else if (e.includes('hurricane') || e.includes('tropical')) add('hurricane', 5);
    else if (e.includes('winter') || e.includes('snow') || e.includes('blizzard')) add('winter_storm', 5);
    else if (e.includes('heat'))                        add('extreme_heat', 5);
    else                                                add('severe_weather', 3);
  });

  if (!Object.keys(scores).length) return [];

  const maxScore = Math.max(...Object.values(scores));
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, score], i) => ({
      rank: i + 1, type, score,
      pct: Math.round(score / maxScore * 100),
      ...(RISK_META[type] || { name: type, icon: '⚠️', color: '#aaa' }),
    }));
}

// ── Checklist data ────────────────────────────────────────────────────────────
const CHECKLISTS = {
  earthquake: {
    confidence: 'high', reason: 'Based on seismic activity detected in your area',
    items: [
      'Water — 1 gal/person/day for 3+ days','Non-perishable food (3-day supply)',
      'Flashlight + extra batteries','First aid kit with manual',
      'Wrench or pliers to shut off utilities','N95 dust masks',
      'Sturdy shoes for every household member','Emergency contact list (printed)',
      'Copies of documents in a waterproof bag','Know your home\'s gas/water shutoffs',
      'Anchor heavy furniture to walls','Identify safe spots in each room (under sturdy tables)',
    ],
  },
  wildfire: {
    confidence: 'high', reason: 'Wildfire events detected in your region',
    items: [
      'N95 masks for smoke inhalation','72-hr go-bag ready to grab',
      'Important docs in a fireproof container','Portable phone charger + cables',
      '30-day medication supply if possible','Know 2+ evacuation routes from home',
      'Register for local emergency alerts','ABC fire extinguisher (10 lb)',
      'Clear vegetation 30+ ft from structure','Cash in small bills',
      'Pet kit (food, water, vet records, carrier)','Paper map of your area',
    ],
  },
  flood: {
    confidence: 'high', reason: 'Flood events detected near your region',
    items: [
      'Waterproof bag for vital documents','Extra water (flooding contaminates supply)',
      'Sandbags or flood barriers for entry points','Battery/hand-crank weather radio',
      'Know your FEMA flood zone','Elevate electrical panels if flood-prone',
      'Sump pump with battery backup','Rubber boots + waterproof gloves',
      'Check for flood insurance (NFIP)','Waterproof tarp (8×10 ft min)',
      'Utility shutoff emergency contacts','Plastic sheeting + duct tape',
    ],
  },
  volcano: {
    confidence: 'high', reason: 'Volcanic activity detected near your region',
    items: [
      'Goggles to protect eyes from ash','N95+ masks (ash is a serious respiratory hazard)',
      'Long-sleeve clothing + long pants','Know local lava-flow evacuation zones',
      'Sign up for volcanic alert notifications','Plastic sheeting to seal vents from ash',
      '3-day water supply (ash contaminates water)','Dust masks for pets',
      'Extra HVAC air filters',
    ],
  },
  winter_storm: {
    confidence: 'high', reason: 'Winter storm risk or alerts detected',
    items: [
      'Road salt or sand for walkways','Snow shovel + vehicle ice scraper',
      'Warm layers (wool/synthetic — not cotton)','Emergency car kit (blanket, shovel, jumper cables)',
      'Backup heat source (CO-safe)','3-day food + water in case roads close',
      'Extra blankets + sleeping bags','Insulate exposed pipes',
      'Know hypothermia first aid','Check on elderly neighbors',
    ],
  },
  hurricane: {
    confidence: 'high', reason: 'Hurricane risk or alerts detected',
    items: [
      '7-day food + water supply (1 gal/person/day)','Portable power station or generator',
      'Hurricane shutters or plywood for windows','Know your storm surge zone + shelter',
      'Full gas tank before storm season','Trim trees near the structure',
      'NOAA Weather Radio (battery-powered)','Emergency cash',
      'Waterproof document storage','First aid kit + medications',
    ],
  },
  tornado: {
    confidence: 'high', reason: 'Tornado risk or alerts detected',
    items: [
      'Designated shelter room (interior, lowest floor, no windows)',
      'Helmet to protect from debris','Sturdy closed-toe shoes',
      'NOAA Weather Radio or reliable alert app','Practice a household tornado drill',
      'First aid kit','Battery backup for phone',
      'Know tornado watch vs. warning difference',
    ],
  },
  extreme_heat: {
    confidence: 'high', reason: 'Extreme heat alerts active in region',
    items: [
      'Fans, portable AC, or local cooling center locations','Electrolyte drinks / oral rehydration salts',
      'Light-colored loose clothing','Blackout curtains to reduce indoor heat',
      'Recognize heat stroke signs + treatment','Check on elderly + young children regularly',
      'Never leave people or pets in parked vehicles','SPF 30+ sunscreen',
      'Schedule outdoor activities for early morning',
    ],
  },
  storm: {
    confidence: 'med', reason: 'Storm events detected in region',
    items: [
      'Battery-powered weather radio','Surge protectors for electronics',
      '72-hr go-bag','First aid kit',
      '3-day food + water supply','Flashlight + extra batteries',
      'Know local shelter locations','Portable phone charger',
    ],
  },
  drought: {
    confidence: 'med', reason: 'Drought conditions detected in region',
    items: [
      'Water conservation plan (low-flow fixtures)','Rainwater collection system',
      'Drought-resistant landscaping','Know local water restrictions',
      'Large water storage containers','Fire-smart landscaping (drought raises fire risk)',
    ],
  },
  severe_weather: {
    confidence: 'med', reason: 'General severe weather risk for this region',
    items: [
      'Battery-powered weather radio','72-hr emergency go-bag',
      'First aid kit','Backup copies of important documents',
      'Know local emergency shelter locations','3-day food + water supply',
      'Flashlight + batteries','Portable phone charger',
    ],
  },
};

const UNIVERSAL = [
  'First aid kit with printed manual',
  'Copies of ID, insurance, and medical records',
  '72-hr go-bag per household member',
  'Printed emergency contact list',
  'Battery or hand-crank radio',
  'Portable phone charger',
];

// ── Natural disaster reference data ───────────────────────────────────────────
const DISASTERS = [
  {
    type:'earthquake', icon:'🌍', color:'#8b7355', name:'Earthquake',
    tagline:'Sudden violent shaking of the ground',
    description:'Earthquakes occur when energy stored in Earth\'s crust is suddenly released, sending seismic waves in all directions. They range from barely perceptible tremors to catastrophic events capable of destroying entire cities in seconds.',
    severity:'Moderate to Extreme', speed:'Seconds of warning (or none)', affected_area:'Localized to regional',
    causes:['Movement along tectonic plate boundaries','Volcanic activity','Underground explosions or mining','Reservoir-induced seismicity from large dams'],
    warning_signs:['Minor foreshocks preceding a major event','Unusual animal behavior — restlessness, fleeing','Low rumbling sounds from the ground','Well water level changes (rare indicator)'],
    during:['DROP to hands and knees immediately','Take COVER under a sturdy desk or against an interior wall away from windows','HOLD ON until shaking stops — it usually lasts under 60 seconds','If outdoors, move away from buildings, power lines, and trees','If driving, pull over away from bridges and overpasses'],
    after:['Expect aftershocks — they can follow minutes, hours, or days later','Inspect your home for structural damage before re-entering','Turn off gas if you smell a leak or hear hissing','Avoid downed power lines','Use texts instead of calls to preserve network capacity'],
    facts:['The largest recorded earthquake was magnitude 9.5 in Valdivia, Chile (1960)','About 500,000 detectable earthquakes occur worldwide each year','The 2004 Indian Ocean quake triggered a tsunami that killed ~230,000 people','A magnitude 8.0 releases about 1,000× the energy of a magnitude 6.0','Most earthquakes occur along the Pacific "Ring of Fire"'],
  },
  {
    type:'wildfire', icon:'🔥', color:'#e85d04', name:'Wildfire',
    tagline:'Uncontrolled fire spreading through vegetation',
    description:'Wildfires are large, uncontrolled fires burning through forests, grasslands, and shrublands. Driven by wind, dry conditions, and available fuel, they can spread faster than a person can run and jump roads and firebreaks with ease.',
    severity:'High to Extreme', speed:'Hours to days (wind-dependent)', affected_area:'Local to regional',
    causes:['Lightning strikes','Human activities: campfires, cigarettes, power lines, arson','Drought and dry conditions increasing available fuel','Climate change extending fire seasons and intensifying droughts'],
    warning_signs:['Smoke visible from a distance','Strong smell of burning','Red-flag conditions: high heat, low humidity, strong winds','Unusual ember or ash fall downwind','Local emergency evacuation orders'],
    during:['Evacuate immediately when ordered — never wait to see the fire','Close all windows, doors, and vents to slow smoke entry','Leave lights on so firefighters can see your home in smoke','Drive with headlights on; watch for animals fleeing the fire','Take your go-bag and essential documents'],
    after:['Do not return until authorities declare it safe','Check roof and attic for hidden embers that could reignite','Wear N95 masks — ash contains toxic particles','Document damage with photos before cleaning up','Be aware of mudslide risk in burned areas when it rains'],
    facts:['Wildfires can move up to 14 mph in open terrain — faster uphill','About 85% of wildfires are caused by humans','The 1871 Peshtigo Fire (Wisconsin) remains the deadliest U.S. wildfire, killing ~2,500','Climate change has roughly doubled the area burned in the western U.S. since the 1980s','A "firenado" (fire whirl) can generate wind speeds exceeding 100 mph'],
  },
  {
    type:'flood', icon:'💧', color:'#4895ef', name:'Flood',
    tagline:'Overflow of water onto normally dry land',
    description:'Floods are the most common and costly natural disaster in the U.S. They occur when water overflows onto land that is normally dry, whether from heavy rainfall, snowmelt, storm surge, or dam failure. Flash floods can develop in minutes with no warning.',
    severity:'Moderate to Extreme', speed:'Flash (minutes) to slow-onset (days)', affected_area:'Local to regional',
    causes:['Heavy or prolonged rainfall','Rapid snowmelt or ice-jam breakup','Storm surges from hurricanes or coastal storms','Dam or levee failure','Flash flooding from intense localized rainfall'],
    warning_signs:['Flood watch or warning issued by the National Weather Service','Rapid rise in stream or river levels','Heavy rain upstream even if it\'s clear locally','Saturated ground unable to absorb more water','Storm surge forecasts for coastal areas'],
    during:['Move to higher ground immediately — do not wait','Never walk, swim, or drive through floodwaters: 6 inches can knock you down; 12 inches can sweep away a car','If trapped in a building, go to the highest floor','Do not touch electrical equipment if you\'re wet or standing in water'],
    after:['Return home only when authorities confirm it is safe','Floodwaters are often contaminated with sewage and chemicals — avoid contact','Discard any food that touched floodwater','Check for structural damage before entering a building','Pump out flooded basements gradually to avoid wall collapse from soil pressure'],
    facts:['Floods kill more people in the U.S. each year than tornadoes or hurricanes','Just 2 feet of moving water can carry away most vehicles including SUVs','Flash floods can strike miles from where rain is actually falling','Flood damage is NOT covered by standard homeowner\'s insurance','The 1931 China floods are the deadliest flood disaster in history, killing up to 4 million people'],
  },
  {
    type:'hurricane', icon:'🌀', color:'#219ebc', name:'Hurricane',
    tagline:'Tropical storm with sustained winds of 74+ mph',
    description:'Hurricanes (typhoons or cyclones in other regions) are powerful tropical storms that form over warm ocean water. They bring violent winds, torrential rain, storm surge, and widespread flooding across large areas — often hundreds of miles wide.',
    severity:'High to Extreme', speed:'Days of advance warning', affected_area:'Regional to large-scale',
    causes:['Warm ocean water (80°F / 26°C or higher) providing energy and moisture','Low wind shear allowing the storm to organize and intensify','Coriolis effect giving the storm its rotation','Moist tropical air fueling the convective engine'],
    warning_signs:['NWS hurricane watches and warnings issued days in advance','Rapidly falling barometric pressure','Increasing ocean swell and surf 1–3 days before landfall','Outer rain bands arriving 24–48 hours before the center','Unusual offshore currents or storm surge warnings'],
    during:['Stay indoors in an interior room away from all windows','Do not go outside during the eye — the storm will resume when the other eyewall arrives','If ordered to evacuate, leave early before roads become dangerous','Stay away from storm surge areas — surge is the #1 hurricane killer','Never use a generator indoors (carbon monoxide can be lethal in minutes)'],
    after:['Wait for an official all-clear before going outside','Avoid standing water and downed power lines','Be wary of weakened trees and structures — they can fall for days afterward','Use flashlights, not candles, to prevent post-storm fires','Report gas leaks to your utility company immediately'],
    facts:['Hurricane Katrina (2005) caused $125 billion in damage — one of the costliest U.S. disasters ever','Storm surge, not wind, is the deadliest hurricane hazard','The Saffir-Simpson scale rates hurricanes 1–5 based on wind speed','Typhoon Tip (1979) is the largest tropical cyclone ever at 1,380 miles wide','Atlantic hurricane season officially runs June 1 – November 30, peaking in September'],
  },
  {
    type:'tornado', icon:'🌪️', color:'#74b0d6', name:'Tornado',
    tagline:'Violently rotating column of air touching the ground',
    description:'Tornadoes are nature\'s most violent storms, capable of wind speeds exceeding 300 mph. They form from severe thunderstorms and can destroy entire neighborhoods within seconds, leaving a damage path that may be miles long.',
    severity:'Moderate to Extreme (EF0–EF5)', speed:'Minutes of warning (sometimes none)', affected_area:'Narrow path, local',
    causes:['Collision of warm moist air with cold dry air creating atmospheric instability','Wind shear — changing wind speed and direction with altitude — providing rotation','Supercell thunderstorms with rotating updrafts (mesocyclones) producing the most violent tornadoes','Most common in "Tornado Alley" (central U.S.) in spring and early summer'],
    warning_signs:['NWS tornado watch or warning in effect','Dark, greenish-colored sky','Large hail often preceding a tornado','Loud roar like a freight train or jet engine','Visible rotating funnel cloud descending from a storm'],
    during:['Go to the lowest floor of a sturdy building in an interior room with no windows','Protect your head and neck with your arms or a bicycle helmet','NEVER shelter under a bridge or overpass — wind speeds actually increase there','If caught outdoors, lie flat in a low ditch away from trees and vehicles','Mobile homes are NOT safe — evacuate to a nearby sturdy building'],
    after:['Watch for downed power lines and gas leaks before moving through debris','Wear sturdy boots — debris fields are filled with nails, glass, and sharp metal','Report injuries or missing persons to local authorities immediately','Photograph damage for your insurance claim','Be alert for weakened building structures that may collapse'],
    facts:['The U.S. experiences about 1,000 tornadoes per year — more than any other country','The widest tornado on record was the 2013 El Reno, Oklahoma tornado at 2.6 miles wide','The most violent tornadoes (EF5) have wind speeds exceeding 300 mph','The 1925 Tri-State Tornado traveled 219 miles across 3 states and killed 695 people','Tornadoes have been recorded on every continent except Antarctica'],
  },
  {
    type:'volcano', icon:'🌋', color:'#ef233c', name:'Volcanic Eruption',
    tagline:'Expulsion of lava, ash, and gases from the Earth',
    description:'Volcanic eruptions occur when magma from deep within the Earth escapes through vents in the crust. Eruptions can produce lava flows, enormous ash clouds, pyroclastic flows, and toxic gases — threatening areas many miles away and even affecting global climate.',
    severity:'High to Extreme', speed:'Hours to days of warning (usually)', affected_area:'Local to hemispheric (ash / climate effects)',
    causes:['Subduction zones where one tectonic plate dives beneath another','Hotspots in the mantle (e.g., Hawaii, Yellowstone)','Rift zones where plates are pulling apart','Magma pressure exceeding the strength of the overlying rock'],
    warning_signs:['Increased earthquake activity (swarms of small quakes beneath the volcano)','Ground deformation — bulging or tilting detected by GPS sensors','Rising sulfur dioxide emissions from vents','Changes in hydrothermal features: new steam vents, hot spring changes','USGS Volcano Observatory alert level rising to Watch or Warning'],
    during:['Evacuate immediately when ordered — eruptions can escalate rapidly','Wear N95+ respirators — volcanic ash causes severe and permanent lung damage','Wear goggles and cover all exposed skin from falling ash','Avoid valleys and low-lying areas — lahars (volcanic mudflows) travel at up to 60 mph','Close all windows and doors to reduce ash intrusion'],
    after:['Do not enter evacuation zones until officially declared safe','Clean ash from rooftops — just 4 inches of wet ash weighs as much as concrete','Avoid driving through ash — it destroys engines and clogs air filters','Monitor air quality — volcanic haze (vog) is hazardous to breathe','Be aware of lahar risk for months or even years after an eruption'],
    facts:['The 1815 eruption of Mount Tambora caused the "Year Without a Summer" in 1816, triggering crop failures worldwide','The 79 AD eruption of Vesuvius buried Pompeii under 13–20 feet of ash and pumice','About 1,500 potentially active volcanoes exist worldwide; ~50 erupt each year','Pyroclastic flows can travel at 450 mph and reach temperatures of 1,800°F','Lava flows on steep slopes have reached speeds of 37 mph'],
  },
  {
    type:'winter_storm', icon:'❄️', color:'#5fb4d0', name:'Winter Storm',
    tagline:'Severe snow, ice, and freezing conditions',
    description:'Winter storms bring dangerous combinations of heavy snow, sleet, freezing rain, and extreme cold. They can paralyze entire regions — shutting down transportation, knocking out power for days, and creating life-threatening conditions, especially for elderly and vulnerable populations.',
    severity:'Moderate to High', speed:'24–48 hours of advance warning', affected_area:'Regional to multi-state',
    causes:['Cold Arctic or polar air masses colliding with moist air','Nor\'easters along the Atlantic coast','Lake-effect snow when cold air passes over relatively warm Great Lakes','La Niña or El Niño patterns shifting the jet stream position'],
    warning_signs:['NWS winter storm watch, warning, or advisory in effect','Rapidly falling temperatures combined with increasing clouds','Barometric pressure dropping quickly','Forecast for multiple inches of snow or significant freezing rain accumulation'],
    during:['Stay indoors — most deaths occur in vehicle accidents on icy roads','Never use a gas stove, grill, or generator indoors (carbon monoxide poisoning risk)','Dress in warm, dry layers if you must go outside: avoid cotton','Recognize hypothermia: shivering stops, confusion, slurred speech → call 911','Check on vulnerable neighbors who may not have adequate heat'],
    after:['Shovel carefully — cardiac arrest from overexertion is a leading cause of winter storm death','Take breaks and stay hydrated while shoveling','Check pipes that may have frozen and burst while you were away','Clear snow from vehicle exhaust pipes before running any engine','Do not use frostbitten skin for friction warming — rewarm slowly in lukewarm water'],
    facts:['More Americans die from winter storms each year than from tornadoes','The Great Blizzard of 1888 buried the Northeast U.S. in 40–50 inches of snow','Ice storms can coat power lines with over 500 lbs of ice per 100-foot span','Wind chill of −25°F can cause frostbite in as little as 10 minutes of exposure','The 1993 "Storm of the Century" affected 26 states simultaneously'],
  },
  {
    type:'drought', icon:'🏜️', color:'#e9a84c', name:'Drought',
    tagline:'Extended period of below-average precipitation',
    description:'Droughts are prolonged periods of abnormally low rainfall that result in water shortages, crop failures, and stressed ecosystems. Unlike most disasters, they develop slowly — over months or years — but their cascading effects on food, water, and wildfire risk can be devastating.',
    severity:'Moderate to Extreme (slow-developing)', speed:'Weeks to months to develop', affected_area:'Regional to continental',
    causes:['Persistent high-pressure systems blocking moisture','Changes in ocean temperature patterns (El Niño / La Niña)','Deforestation reducing moisture recycling by vegetation','Climate change altering precipitation patterns globally','Overuse of groundwater beyond natural recharge rates'],
    warning_signs:['U.S. Drought Monitor showing drought conditions in your area','Extended periods without significant rainfall','Declining stream flows and reservoir levels','Soil moisture deficits building over consecutive weeks','Local water-use restrictions being implemented'],
    during:['Conserve water rigorously: fix leaks, use water-efficient fixtures','Follow all local water restrictions and stage-based conservation rules','Reduce lawn irrigation — landscaping accounts for ~30% of household water use','Be acutely aware of elevated wildfire risk — report any fire immediately'],
    after:['Continue conservation measures — aquifers take years to recover after a drought','Document agricultural losses for disaster assistance programs','Plant drought-resistant native species when revegetating','Invest in water storage, greywater reuse, and rainwater harvesting systems','Support policies for sustainable long-term water management'],
    facts:['The Dust Bowl drought of the 1930s forced 2.5 million people to flee the Great Plains','The 2012–2016 California drought cost over $3 billion in agricultural losses','About 55 million people are affected by droughts globally each year','A "megadrought" in the American West lasted over 19 years into the 21st century','Agriculture accounts for roughly 70% of all global freshwater consumption'],
  },
  {
    type:'extreme_heat', icon:'🌡️', color:'#e76f51', name:'Extreme Heat',
    tagline:'Dangerously high temperatures above normal range',
    description:'Extreme heat events occur when temperatures remain far above historical averages for extended periods, often combined with high humidity. Heat is the leading weather-related cause of death in the U.S., killing more people annually than tornadoes, hurricanes, and floods combined.',
    severity:'Moderate to Extreme', speed:'Days of advance warning', affected_area:'Regional to continental',
    causes:['Persistent high-pressure systems trapping hot air near the surface','Urban heat island effect — pavement and buildings absorb and radiate extra heat','High humidity preventing the body\'s sweat-cooling mechanism from working','Climate change increasing the frequency, intensity, and duration of heat waves'],
    warning_signs:['NWS excessive heat watch, warning, or advisory in effect','Forecast temperatures significantly above historical averages for several days','High overnight temperatures that prevent the body from recovering','Humidity index showing dangerous "feels like" temperatures above 103°F'],
    during:['Stay in air-conditioned buildings — go to a cooling center if you lack AC at home','Drink water every 15–20 minutes even if you don\'t feel thirsty','Avoid alcohol and caffeine, which accelerate dehydration','NEVER leave children, elderly, or pets in parked vehicles — car interiors can exceed 120°F within minutes','Recognize heat stroke: hot dry skin, confusion, no sweating — call 911 immediately'],
    after:['Gradually re-acclimate rather than immediately returning to strenuous outdoor activity','Seek medical care for any signs of heat-related illness (cramps, exhaustion, or stroke)','Check on elderly neighbors, infants, and anyone without access to cooling','Report non-functioning cooling centers to local emergency management'],
    facts:['The 2003 European heat wave killed over 70,000 people','The U.S. record high is 134°F (56.7°C) in Death Valley, California (1913)','A parked car\'s interior can reach 120°F when outside temps are just 70°F','Urban areas can be 7°F hotter than surrounding rural areas due to the heat island effect','Heat kills more Americans annually than any other weather hazard'],
  },
  {
    type:'tsunami', icon:'🌊', color:'#023e8a', name:'Tsunami',
    tagline:'Series of massive ocean waves triggered by seismic events',
    description:'Tsunamis are large ocean waves generated by undersea earthquakes, volcanic eruptions, or submarine landslides. Often incorrectly called "tidal waves," they have nothing to do with tides. In the deep ocean they are barely detectable, but they compress and surge to terrifying heights as they approach the shore.',
    severity:'Extreme', speed:'Minutes (local source) to hours (distant source)', affected_area:'Coastal, can cross entire ocean basins',
    causes:['Undersea earthquakes at subduction zones (magnitude 7.5 or higher)','Submarine volcanic eruptions displacing large volumes of water','Underwater or coastal landslides','Meteorite ocean impacts (extremely rare)'],
    warning_signs:['A large earthquake felt near or under the ocean','The sea rapidly and unusually receding (draining) — run to high ground immediately','A loud roar from the direction of the ocean','Tsunami Warning Center official alerts (Pacific and Atlantic systems)','Emergency sirens in coastal areas'],
    during:['Move immediately to high ground — do not wait for official confirmation if you felt the earthquake','Go as far inland as possible, not just to a slight rise','If you cannot reach high ground, go to the upper floors of a tall reinforced building','The first wave is rarely the largest — multiple waves arrive over several hours','Stay away from the shore until authorities issue an official all-clear'],
    after:['Do not return to low-lying coastal areas until the all-clear is given','Debris-filled floodwater poses serious drowning, entrapment, and contamination risks','Saltwater flooding contaminates freshwater sources — use emergency water supplies','Aftershocks from the triggering earthquake may generate additional tsunami waves','Help may take many days to arrive — be self-sufficient'],
    facts:['The 2004 Indian Ocean tsunami killed approximately 230,000 people across 14 countries','Tsunamis can travel across entire ocean basins at speeds up to 500 mph','The highest tsunami wave ever recorded was 1,720 feet in Lituya Bay, Alaska (1958)','In the deep ocean, a tsunami may only raise the sea surface by 1–2 feet','About 80% of all tsunamis occur in the Pacific "Ring of Fire"'],
  },
  {
    type:'landslide', icon:'⛰️', color:'#8b5e3c', name:'Landslide',
    tagline:'Mass movement of rock, debris, or earth down a slope',
    description:'Landslides occur when masses of rock, earth, or debris suddenly move down a slope. They can be triggered by earthquakes, heavy rainfall, volcanic activity, or human alteration of slopes. Debris flows (mudslides) are particularly dangerous, traveling at speeds up to 35 mph with little warning.',
    severity:'Moderate to Extreme', speed:'Seconds to minutes (catastrophic onset)', affected_area:'Local (can cover large areas)',
    causes:['Heavy or prolonged rainfall saturating and destabilizing slopes','Earthquakes shaking loose unconsolidated material','Volcanic activity melting snow and ice (lahars)','Erosion undercutting slope bases','Construction on or near steep slopes','Deforestation removing root systems that hold soil in place'],
    warning_signs:['New cracks appearing in the ground, pavement, or building walls','Leaning trees, utility poles, or fences that were previously straight','Doors and windows suddenly sticking in their frames','Water seeping from slopes or unusual ground bulging','Cracking or rumbling sounds, or trees snapping','Rapidly increased stream turbidity (muddiness) after rainfall'],
    during:['Evacuate immediately if you suspect a landslide is imminent — do not wait to confirm','If escape is impossible, curl into a ball and protect your head','Run perpendicular to the slide path, not directly downslope','Avoid river valleys and low-lying areas during heavy rain following recent wildfires'],
    after:['Stay well away from the slide area — additional slides are common','Do not enter unstable areas to search for injured persons — wait for rescue crews','Report downed power lines, gas leaks, and broken water mains immediately','Listen for unusual cracking or rumbling sounds indicating continuing movement','Document damage with photos before any cleanup begins'],
    facts:['Landslides kill about 25–50 people in the U.S. each year','The deadliest landslide on record was the 1920 Haiyuan, China event (~200,000 deaths)','Wildfires dramatically increase landslide risk by removing stabilizing vegetation','Underwater landslides can displace enough water to trigger tsunamis','The 2014 Oso, Washington landslide buried 1 square mile of a neighborhood in 3–5 minutes'],
  },
  {
    type:'thunderstorm', icon:'⛈️', color:'#6a4c93', name:'Thunderstorm',
    tagline:'Violent storm with lightning, heavy rain, and damaging winds',
    description:'Thunderstorms are among the most common severe weather events, occurring about 40,000 times per day worldwide. They can produce lightning, damaging wind gusts, large hail, heavy flooding rainfall, and even tornadoes — making them one of the most versatile natural hazards.',
    severity:'Moderate to Severe', speed:'30–60 minutes of warning', affected_area:'Local to sub-regional',
    causes:['Warm moist air rapidly rising through cooler air layers (convective instability)','Cold fronts or dry lines forcing air upward','Daytime surface heating generating afternoon convection','Organized storm systems (squall lines, mesoscale convective systems)'],
    warning_signs:['Towering cumulonimbus clouds developing rapidly','Darkening skies, especially in the west or southwest','Sudden drop in temperature and increase in wind speed','Distant thunder or lightning flashes','NWS severe thunderstorm watch or warning issued'],
    during:['Get indoors immediately — no place outdoors is safe during lightning','Avoid windows, corded phones, plumbing, and concrete walls (which conduct electricity)','If caught outdoors, avoid tall trees, open fields, water, and high ground','If driving, pull safely off the road away from trees and power lines','Wait 30 minutes after the last thunder clap before resuming outdoor activities'],
    after:['Check for downed power lines and structural damage before going outdoors','Report flooding to emergency services — even shallow fast water is dangerous','Check on neighbors, especially after hail damage or flooding','Inspect your home for roof damage, broken windows, and water intrusion','Assess trees on your property — struck or waterlogged trees may fall later'],
    facts:['Lightning strikes the Earth about 100 times every second','The U.S. experiences about 100,000 thunderstorms per year','Large hail (2+ inches) can fall at speeds exceeding 100 mph, causing serious injury','A single bolt of lightning is about 5× hotter than the surface of the sun','About 2,000 people are killed by lightning worldwide each year'],
  },
];

// ── Analysis window picker ────────────────────────────────────────────────────
function applyYears(n) {
  const input = document.getElementById('yrInput');
  input.value = n;
  setAnalysisYears(n);
}

function applyDays(days) {
  if (!currentLocation) return;
  analysisYears = days / 365.25;
  analysisLabel = days === 1 ? '1-day' : days === 7 ? '7-day' : '30-day';
  document.querySelectorAll('.yr-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.period-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.days === days));
  setupSliderDays(days);
  const risks = analyzeRisks(storedEarthquakes, storedNaturalEvents, storedAlerts, analysisYears);
  renderRisks(risks);
  renderChecklist(risks);
}

async function setAnalysisYears(n) {
  n = Math.max(1, Math.min(20, Math.round(n)));
  if (!currentLocation) return;
  analysisYears = n;
  analysisLabel = n + '-yr';

  // Sync input and preset buttons
  document.getElementById('yrInput').value = n;
  document.querySelectorAll('.yr-btn').forEach(b => b.classList.toggle('active', +b.dataset.yr === n));
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));

  // Re-fetch if the requested window exceeds what we have cached
  if (n > cachedYears) {
    document.getElementById('risksBody').innerHTML =
      '<div style="font-size:0.83rem;color:var(--text-dim);padding:4px 0">Fetching extended data…</div>';
    const [eqs, natEvs] = await Promise.all([
      fetchUSGS(currentLocation.lat, currentLocation.lon, n),
      fetchEONET(currentLocation.lat, currentLocation.lon, n),
    ]);
    storedEarthquakes = eqs;
    storedNaturalEvents = natEvs;
    allEvents = [...eqs, ...natEvs];
    cachedYears = n;
  }

  setupSlider(n);
  const risks = analyzeRisks(storedEarthquakes, storedNaturalEvents, storedAlerts, n);
  renderRisks(risks);
  renderChecklist(risks);
}

// ── Render: Alerts ─────────────────────────────────────────────────────────────
function renderAlerts(alerts) {
  document.getElementById('statAlerts').textContent = alerts.length;
  const banner = document.getElementById('alertsBanner');
  if (!alerts.length) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  document.getElementById('alertsBody').innerHTML = alerts.slice(0, 3).map(a => `
    <div class="alert-entry">
      <div class="alert-headline">${a.event} — ${a.severity}</div>
      <div class="alert-area">${(a.areas || '').split(';')[0]}</div>
    </div>`).join('');
}

// ── Render: Risks ──────────────────────────────────────────────────────────────
function renderRisks(risks) {
  currentRisks = risks;
  if (!risks.length) {
    document.getElementById('risksBody').innerHTML =
      `<div style="font-size:0.83rem;color:var(--text-dim);padding:8px 0;">${t('no_events')}</div>`;
    return;
  }
  document.getElementById('risksBody').innerHTML = risks.map(r => {
    const color = EVENT_COLORS[r.type] || '#8892a4';
    return `
    <div class="risk-item">
      <div class="risk-rank" style="background:${color}22; color:${color}">${r.rank}</div>
      <div class="risk-info">
        <div class="risk-name" style="color:${color}">${r.icon} ${t('risk_' + r.type) || r.name}</div>
        <div class="risk-desc">${r.score} ${r.score !== 1 ? t('weighted_events') : t('weighted_event')} · ${analysisLabel} window</div>
      </div>
      <div class="risk-bar-wrap">
        <div class="risk-bar" style="width:${r.pct}%; background:${color}"></div>
      </div>
    </div>`;
  }).join('');
}

// ── Render: Checklist ──────────────────────────────────────────────────────────
function ckKey(groupType, idx) {
  return `mrr_ck_${currentLocation?.name}_${groupType}_${idx}`;
}

function renderChecklist(risks) {
  const groups = risks.map(r => ({ ...CHECKLISTS[r.type], icon: r.icon, name: r.name, type: r.type }))
    .filter(g => g.items)
    .concat([{ icon: '🧰', name: 'Universal Essentials', type: 'universal', items: UNIVERSAL, confidence: 'high', reason: 'Applies to every emergency type' }]);

  const confMap = { high: ['conf-high', t('conf_high')], med: ['conf-med', t('conf_med')], low: ['conf-low', t('conf_low')] };

  document.getElementById('checklistGrid').innerHTML = groups.map(g => {
    const displayName = g.type === 'universal' ? t('universal_name') : (t('risk_' + g.type) || g.name);
    const reason      = g.type === 'universal' ? t('universal_reason') : (t('ck_' + g.type + '_reason') || g.reason);
    const items       = (t('ck_' + g.type + '_items') || (g.type === 'universal' ? UNIVERSAL : g.items) || []);
    const [cls, label] = confMap[g.confidence] || ['conf-med', t('conf_med')];
    const checkedCount = items.filter((_, i) => localStorage.getItem(ckKey(g.type, i)) === '1').length;
    const initPct = items.length ? Math.round(checkedCount / items.length * 100) : 0;
    const itemsHtml = items.map((item, i) => {
      const key = ckKey(g.type, i);
      const checked = localStorage.getItem(key) === '1';
      return `<div class="checklist-item">
        <input type="checkbox" class="kit-cb" id="${key}" data-key="${key}" ${checked ? 'checked' : ''} onchange="toggleItem(this)"/>
        <label class="cb-label ${checked ? 'done' : ''}" for="${key}">${item}</label>
      </div>`;
    }).join('');
    return `<div class="checklist-group" data-group="${g.type}">
      <div class="checklist-group-head">${g.icon} ${displayName}<span class="conf-badge ${cls}">${label}</span></div>
      <div class="checklist-reason">${reason}</div>
      ${itemsHtml}
      <div class="ck-group-bar-wrap"><div class="ck-group-bar-fill" style="width:${initPct}%;background-color:${pctColor(initPct)}"></div></div>
      <button class="ck-reset-btn" onclick="resetGroup('${g.type}', ${items.length})">${t('reset_btn')}</button>
    </div>`;
  }).join('');
  updateChecklistProgress();
}

function updateChecklistProgress() {
  const all = document.querySelectorAll('#checklistGrid .kit-cb');
  const checkedCount = document.querySelectorAll('#checklistGrid .kit-cb:checked').length;
  if (!all.length) return;
  const pct = Math.round(checkedCount / all.length * 100);
  document.getElementById('ckPct').textContent = pct + '%';
  setBar(document.getElementById('ckBar'), pct);
}

function toggleItem(cb) {
  localStorage.setItem(cb.dataset.key, cb.checked ? '1' : '0');
  cb.nextElementSibling.classList.toggle('done', cb.checked);
  if (cb.checked) {
    const item = cb.parentElement;
    item.classList.remove('ck-pop');
    void item.offsetWidth;
    item.classList.add('ck-pop');
    item.addEventListener('animationend', () => item.classList.remove('ck-pop'), { once: true });
  }
  const group = cb.closest('.checklist-group');
  if (group) {
    const cbs = group.querySelectorAll('.kit-cb');
    const pct = Math.round(group.querySelectorAll('.kit-cb:checked').length / cbs.length * 100);
    setBar(group.querySelector('.ck-group-bar-fill'), pct);
  }
  updateChecklistProgress();
  renderTracker();
}

function resetGroup(type, count) {
  for (let i = 0; i < count; i++) localStorage.removeItem(ckKey(type, i));
  const group = document.querySelector(`.checklist-group[data-group="${type}"]`);
  if (!group) return;
  group.querySelectorAll('.kit-cb').forEach(cb => {
    cb.checked = false;
    cb.nextElementSibling.classList.remove('done');
  });
  setBar(group.querySelector('.ck-group-bar-fill'), 0);
  updateChecklistProgress();
}

// ── Map ────────────────────────────────────────────────────────────────────────
const EVENT_COLORS = { earthquake: '#4ecdc4', wildfire: '#ff6b35', flood: '#6495ed', volcano: '#ef476f', storm: '#ffd166', drought: '#f4a261' };
const BADGE_CLASSES = { earthquake: 'b-eq', wildfire: 'b-fire', flood: 'b-flood', volcano: 'b-vol', storm: 'b-storm' };

function initMap(lat, lon) {
  if (map) { map.remove(); map = null; }
  map = L.map('map').setView([lat, lon], 7);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19,
  }).addTo(map);
  L.circleMarker([lat, lon], { radius: 9, fillColor: '#fff', color: '#fff', weight: 2, fillOpacity: 0.9 })
    .addTo(map).bindPopup('<b>Your search location</b>');
}

function renderMapEvents(events) {
  if (markerLayer) { map.removeLayer(markerLayer); }
  markerLayer = L.layerGroup().addTo(map);
  const counts = {};

  for (const ev of events) {
    if (!ev.lat || !ev.lon) continue;
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    const color = EVENT_COLORS[ev.type] || '#aaa';
    const r = ev.type === 'earthquake' ? Math.max(3, (ev.mag || 3) * 2) : 6;
    const dateStr = ev.date ? ev.date.toLocaleDateString() : 'Unknown date';
    const magLine = ev.mag != null ? `<br>Magnitude: <b>${ev.mag.toFixed(1)}</b>` : '';
    L.circleMarker([ev.lat, ev.lon], { radius: r, fillColor: color, color: color, weight: 1, fillOpacity: 0.55 })
      .bindPopup(`<div class="popup-title">${ev.title || ev.type}</div><div class="popup-detail">${dateStr}${magLine}</div>`)
      .addTo(markerLayer);
  }

  document.getElementById('statEq').textContent    = counts.earthquake || 0;
  document.getElementById('statFire').textContent  = counts.wildfire || 0;
  document.getElementById('statFlood').textContent = counts.flood || 0;
  document.getElementById('mapCount').textContent  = `— ${events.length} events`;
  document.getElementById('mapLegend').innerHTML = Object.entries(counts)
    .map(([t, n]) => `<span class="badge ${BADGE_CLASSES[t] || 'b-other'}">${t} (${n})</span>`).join('');
}

// ── Time Slider ────────────────────────────────────────────────────────────────
function windowEvents(years) {
  const cutoff = new Date(Date.now() - years * 365.25 * 86400000);
  return allEvents.filter(ev => !ev.date || ev.date >= cutoff);
}

function stopPlay() {
  if (playInterval) { clearInterval(playInterval); playInterval = null; document.getElementById('playBtn').textContent = t('play'); }
}

function setupSlider(years) {
  stopPlay();
  const curYear = new Date().getFullYear();
  sliderYears = Array.from({ length: years }, (_, i) => curYear - years + 1 + i);
  const slider = document.getElementById('timeSlider');
  slider.min = 0;
  slider.max = years;
  slider.value = years;
  document.getElementById('sliderRange').textContent = `${sliderYears[0]} – ${curYear}`;
  document.getElementById('timeDisplay').textContent = 'All Years';
  renderMapEvents(windowEvents(years));

  slider.oninput = () => {
    const idx = parseInt(slider.value);
    const year = idx < years ? sliderYears[idx] : null;
    document.getElementById('timeDisplay').textContent = year ? String(year) : 'All Years';
    const base = windowEvents(years);
    if (year === null) {
      renderMapEvents(base);
    } else {
      const yStart = new Date(year, 0, 1).getTime();
      const yEnd   = new Date(year + 1, 0, 1).getTime();
      renderMapEvents(base.filter(e => {
        if (!e.date) return year === curYear; // ongoing events (no date) show in current year
        return e.date.getTime() >= yStart && e.date.getTime() < yEnd;
      }));
    }
  };
}

function setupSliderDays(totalDays) {
  stopPlay();
  const isHours = totalDays === 1;
  const steps = isHours ? 24 : totalDays;
  const slider = document.getElementById('timeSlider');
  slider.min = 0;
  slider.max = steps;
  slider.value = steps;

  if (isHours) {
    document.getElementById('sliderRange').textContent = 'Last 24 hours';
  } else {
    const oldest = new Date(Date.now() - (totalDays - 1) * 86400000);
    document.getElementById('sliderRange').textContent =
      `${oldest.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – Today`;
  }
  document.getElementById('timeDisplay').textContent = 'All';

  const base = windowEvents(totalDays / 365.25);
  renderMapEvents(base);

  slider.oninput = () => {
    const idx = parseInt(slider.value);
    if (idx >= steps) {
      document.getElementById('timeDisplay').textContent = 'All';
      renderMapEvents(base);
      return;
    }
    if (isHours) {
      const hoursAgo = 23 - idx;
      const target = new Date(Date.now() - hoursAgo * 3600000);
      document.getElementById('timeDisplay').textContent =
        hoursAgo === 0 ? 'This hour' : `${hoursAgo}h ago`;
      renderMapEvents(base.filter(e => {
        if (!e.date) return false;
        return e.date.getFullYear() === target.getFullYear() &&
               e.date.getMonth()    === target.getMonth()    &&
               e.date.getDate()     === target.getDate()     &&
               e.date.getHours()    === target.getHours();
      }));
    } else {
      const daysAgo = totalDays - 1 - idx;
      const target = new Date(Date.now() - daysAgo * 86400000);
      document.getElementById('timeDisplay').textContent =
        daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
      renderMapEvents(base.filter(e => e.date && e.date.toDateString() === target.toDateString()));
    }
  };
}

function togglePlay() {
  const btn = document.getElementById('playBtn');
  const slider = document.getElementById('timeSlider');
  const sliderMax = parseInt(slider.max);

  if (playInterval) {
    clearInterval(playInterval); playInterval = null;
    btn.textContent = '▶ Resume'; return;
  }

  if (parseInt(slider.value) >= sliderMax) {
    slider.value = 0;
    slider.dispatchEvent(new Event('input'));
  }

  btn.textContent = t('pause');
  playInterval = setInterval(() => {
    const next = parseInt(slider.value) + 1;
    if (next > sliderMax) {
      clearInterval(playInterval); playInterval = null;
      btn.textContent = t('play'); return;
    }
    slider.value = next;
    slider.dispatchEvent(new Event('input'));
  }, 900);
}

// ── Household Tracker ─────────────────────────────────────────────────────────
const DEFAULT_TASKS = ['Go-bag packed', 'Emergency contacts memorized', 'Evacuation route reviewed', 'Phone + charger ready'];
let openEditorMember = null;

function saveFamilies() { localStorage.setItem('mrr_families', JSON.stringify(families)); }
function memberItemKey(name, label) { return `mrr_mi_${name}::${label}`; }
function getMemberTasks(name) { return JSON.parse(localStorage.getItem('mrr_tasks_' + name) || 'null') || DEFAULT_TASKS.slice(); }
function saveMemberTasks(name, tasks) { localStorage.setItem('mrr_tasks_' + name, JSON.stringify(tasks)); }

function getMemberPct(name) {
  const tasks = getMemberTasks(name);
  if (!tasks.length) return 0;
  const checked = tasks.filter(label => localStorage.getItem(memberItemKey(name, label)) === '1').length;
  return Math.round(checked / tasks.length * 100);
}

function getFamilyPct(fam) {
  if (!fam.members.length) return 0;
  return Math.round(fam.members.reduce((s, m) => s + getMemberPct(m), 0) / fam.members.length);
}

function renderMemberTaskEditor(name, tasks) {
  const safe = name.replace(/'/g, "\\'");
  const taskRows = tasks.length
    ? tasks.map((t, i) => `<div class="task-editor-item">
        <span class="task-editor-label">${t}</span>
        <button class="task-editor-del" onclick="removeMemberTask('${safe}',${i})">×</button>
      </div>`).join('')
    : '<div style="font-size:0.73rem;color:var(--text-dim);padding:2px 4px;">No tasks yet.</div>';
  return `<div class="member-task-editor-panel">
    <div class="task-editor-list">${taskRows}</div>
    <div class="task-add-row" style="margin-top:6px;">
      <input type="text" class="tracker-input member-task-input" data-member="${name}" placeholder="New task…" maxlength="50" style="padding:4px 8px;font-size:0.75rem;" onkeydown="if(event.key==='Enter')addMemberTask('${safe}')"/>
      <button class="btn btn-secondary" style="padding:4px 8px;font-size:0.75rem;" onclick="addMemberTask('${safe}')">+ Add</button>
    </div>
  </div>`;
}

function renderMemberCard(name, famId) {
  const tasks = getMemberTasks(name);
  const pct = getMemberPct(name);
  const safe = name.replace(/'/g, "\\'");
  const safeFam = famId.replace(/'/g, "\\'");
  const isEditing = openEditorMember === name;
  const statusClass = pct === 100 ? 'ready' : pct > 0 ? 'progress' : 'idle';
  const editorHtml = isEditing ? renderMemberTaskEditor(name, tasks) : '';
  const items = tasks.length
    ? tasks.map(label => {
        const ck = localStorage.getItem(memberItemKey(name, label)) === '1';
        const safeLabel = label.replace(/'/g, "\\'");
        return `<label class="member-item">
          <input type="checkbox" ${ck ? 'checked' : ''} onchange="toggleMemberItem('${safe}','${safeLabel}',this)"/>
          ${label}
        </label>`;
      }).join('')
    : '<div style="font-size:0.73rem;color:var(--text-dim);">No tasks — click ✏️ Edit to add.</div>';
  return `<div class="tracker-card" data-member="${name}">
    <div class="tracker-name-row">
      <span class="status-dot ${statusClass}"></span>
      <span>${name}</span>
      <span class="tracker-pct">${pct}%</span>
      <button class="member-edit-tasks${isEditing ? ' active' : ''}" onclick="toggleMemberTaskEditor('${safe}')">✏️ Edit</button>
      <button class="member-remove" onclick="removeMemberFromFamily('${safeFam}','${safe}')">×</button>
    </div>
    ${editorHtml}
    <div class="tracker-bar-bg"><div class="tracker-bar-fill" style="width:${pct}%;background-color:${pctColor(pct)}"></div></div>
    <div class="member-items">${items}</div>
    ${pct === 100 ? '<div class="member-ready-badge">✓ READY</div>' : ''}
  </div>`;
}

function renderTracker() {
  const grid = document.getElementById('trackerGrid');
  if (!families.length) {
    grid.innerHTML = '<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">No families yet — add one below.</div>';
    return;
  }
  grid.innerHTML = families.map(fam => {
    const famPct = getFamilyPct(fam);
    const safeFam = fam.id.replace(/'/g, "\\'");
    const memberCards = fam.members.length
      ? fam.members.map(m => renderMemberCard(m, fam.id)).join('')
      : '<div style="font-size:0.78rem;color:var(--text-dim);padding:0 4px;">No members yet.</div>';
    const liveHtml = fam.isLive && fam.code
      ? `<span class="live-badge">● LIVE</span><button class="code-btn" data-code="${fam.code}" onclick="copyFamilyCode('${fam.code}')" title="Click to copy invite code">📋 ${fam.code}</button>`
      : `<button class="go-live-btn" onclick="goLive('${safeFam}')">Go Live</button>`;
    return `<div class="family-section" data-family="${fam.id}">
      <div class="family-header">
        <span class="family-name">👨‍👩‍👧 ${fam.name}</span>
        ${liveHtml}
        <span class="family-pct">${famPct}% ready</span>
        <button class="family-remove" onclick="removeFamily('${safeFam}')">×</button>
      </div>
      <div class="family-bar-bg"><div class="family-bar-fill" style="width:${famPct}%;background-color:${pctColor(famPct)}"></div></div>
      <div class="family-members">${memberCards}</div>
      <div class="family-add-member">
        <input type="text" class="tracker-input family-member-input" data-family="${fam.id}" placeholder="Add member name…" maxlength="30" style="padding:5px 10px;font-size:0.8rem;" onkeydown="if(event.key==='Enter')addMemberToFamily('${safeFam}')"/>
        <button class="btn btn-secondary" style="padding:5px 10px;font-size:0.8rem;" onclick="addMemberToFamily('${safeFam}')">+ Add</button>
      </div>
    </div>`;
  }).join('');
}

function toggleMemberTaskEditor(name) {
  openEditorMember = openEditorMember === name ? null : name;
  renderTracker();
}

function addMemberTask(name) {
  const input = document.querySelector(`.member-task-input[data-member="${name}"]`);
  if (!input) return;
  const label = input.value.trim();
  if (!label) return;
  const tasks = getMemberTasks(name);
  if (tasks.includes(label)) return;
  tasks.push(label);
  saveMemberTasks(name, tasks);
  renderTracker();
}

function removeMemberTask(name, i) {
  const tasks = getMemberTasks(name);
  tasks.splice(i, 1);
  saveMemberTasks(name, tasks);
  renderTracker();
}

function toggleMemberItem(name, label, cb) {
  localStorage.setItem(memberItemKey(name, label), cb.checked ? '1' : '0');
  const pct = getMemberPct(name);
  const card = document.querySelector(`.tracker-card[data-member="${name}"]`);
  if (card) {
    card.querySelector('.tracker-pct').textContent = pct + '%';
    setBar(card.querySelector('.tracker-bar-fill'), pct);
    const dot = card.querySelector('.status-dot');
    if (dot) dot.className = 'status-dot ' + (pct === 100 ? 'ready' : pct > 0 ? 'progress' : 'idle');
    const badge = card.querySelector('.member-ready-badge');
    if (pct === 100 && !badge) {
      const el = document.createElement('div');
      el.className = 'member-ready-badge'; el.textContent = '✓ READY'; card.appendChild(el);
    } else if (pct < 100 && badge) badge.remove();
    const famSection = card.closest('.family-section');
    if (famSection) {
      const fam = families.find(f => f.id === famSection.dataset.family);
      if (fam) {
        const fp = getFamilyPct(fam);
        famSection.querySelector('.family-pct').textContent = fp + '% ready';
        setBar(famSection.querySelector('.family-bar-fill'), fp);
        if (!applyingRemote) pushProgressToYjs(fam, name);
      }
    }
  }
}

function addFamily() {
  const input = document.getElementById('familyInput');
  const name = input.value.trim();
  if (!name) return;
  if (hasProfanity(name)) { showInputWarn('familyInput', 'Please keep the family name clean.'); return; }
  families.push({ id: 'fam_' + Date.now(), name, members: [] });
  saveFamilies();
  input.value = '';
  renderTracker();
}

function removeFamily(id) {
  const fam = families.find(f => f.id === id);
  if (fam) {
    fam.members.forEach(m => localStorage.removeItem('mrr_tasks_' + m));
    if (fam.code && ydocs[fam.code]) {
      try { ydocs[fam.code].ws?.destroy(); ydocs[fam.code].idb?.destroy(); } catch(e) {}
      delete ydocs[fam.code];
    }
  }
  families = families.filter(f => f.id !== id);
  saveFamilies();
  renderTracker();
}

function addMemberToFamily(famId) {
  const input = document.querySelector(`.family-member-input[data-family="${famId}"]`);
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  const fam = families.find(f => f.id === famId);
  if (!fam || fam.members.includes(name)) return;
  fam.members.push(name);
  saveFamilies();
  if (!localStorage.getItem('mrr_tasks_' + name)) saveMemberTasks(name, DEFAULT_TASKS.slice());
  input.value = '';
  if (fam.isLive) pushMemberToYjs(fam, name);
  renderTracker();
}

function removeMemberFromFamily(famId, name) {
  const fam = families.find(f => f.id === famId);
  if (!fam) return;
  fam.members = fam.members.filter(m => m !== name);
  saveFamilies();
  localStorage.removeItem('mrr_tasks_' + name);
  if (openEditorMember === name) openEditorMember = null;
  renderTracker();
}

// ── Weather ───────────────────────────────────────────────────────────────────
let weatherData = null;
let weatherUnits = { temp: 'C', wind: 'mph', precip: 'in' };

const WMO_ICON = code =>
  code === 0 ? '☀️' : code <= 3 ? '⛅' : code <= 48 ? '🌫️' :
  code <= 57 ? '🌦️' : code <= 67 ? '🌧️' : code <= 77 ? '❄️' :
  code <= 82 ? '🌧️' : code <= 86 ? '❄️' : '⛈️';

const WMO_DESC = code =>
  code === 0 ? t('wmo_0') : code === 1 ? t('wmo_1') : code === 2 ? t('wmo_2') :
  code === 3 ? t('wmo_3') : code <= 48 ? t('wmo_fog') : code <= 57 ? t('wmo_drizzle') :
  code <= 67 ? t('wmo_rain') : code <= 77 ? t('wmo_snow') : code <= 82 ? t('wmo_rain_showers') :
  code <= 86 ? t('wmo_snow_showers') : t('wmo_thunderstorm');

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code` +
    `&temperature_unit=celsius&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  return (await res.json()).current;
}

function renderWeather(data) {
  if (!data) return;
  const code = data.weather_code;

  // API always returns °C, mph, inches — convert at render time
  const rawTemp   = data.temperature_2m;
  const rawFeels  = data.apparent_temperature;
  const rawWind   = data.wind_speed_10m;
  const rawPrecip = data.precipitation;

  const tempVal  = weatherUnits.temp === 'C' ? Math.round(rawTemp)  : Math.round(rawTemp  * 9/5 + 32);
  const feelsVal = weatherUnits.temp === 'C' ? Math.round(rawFeels) : Math.round(rawFeels * 9/5 + 32);
  const tempUnit = weatherUnits.temp === 'C' ? '°C' : '°F';

  const windVal  = weatherUnits.wind === 'mph' ? Math.round(rawWind) : Math.round(rawWind * 1.60934);
  const windUnit = weatherUnits.wind === 'mph' ? 'mph' : 'km/h';

  const precipVal  = weatherUnits.precip === 'in' ? rawPrecip.toFixed(2) : (rawPrecip * 2.54).toFixed(2);
  const precipUnit = weatherUnits.precip === 'in' ? 'in' : 'cm';

  document.getElementById('weatherBody').innerHTML = `
    <div style="text-align:center; padding:28px 0 18px;">
      <div style="font-size:4.5rem; line-height:1; margin-bottom:10px;">${WMO_ICON(code)}</div>
      <div style="font-size:0.9rem; color:var(--text-dim); margin-bottom:10px; font-weight:600; letter-spacing:0.03em;">${WMO_DESC(code)}</div>
      <div style="font-size:4rem; font-weight:700; color:var(--accent); line-height:1;">${tempVal}${tempUnit}</div>
      <div style="font-size:0.88rem; color:var(--text-dim); margin-top:10px;">${t('feels_like')} <strong style="color:var(--text);">${feelsVal}${tempUnit}</strong></div>
    </div>
    <div class="weather-grid">
      <div class="weather-stat-card">
        <div class="weather-stat-icon">💨</div>
        <div class="weather-stat-label">${t('wind_speed')}</div>
        <div class="weather-stat-value">${windVal} <span style="font-size:0.9rem;color:var(--text-dim);">${windUnit}</span></div>
      </div>
      <div class="weather-stat-card">
        <div class="weather-stat-icon">🌧️</div>
        <div class="weather-stat-label">${t('precipitation')}</div>
        <div class="weather-stat-value">${precipVal} <span style="font-size:0.9rem;color:var(--text-dim);">${precipUnit}</span></div>
      </div>
    </div>`;
}

function setWeatherUnit(type, val) {
  weatherUnits[type] = val;
  document.querySelectorAll(`.unit-btn[data-unit-type="${type}"]`).forEach(b => {
    b.classList.toggle('active', b.dataset.unitVal === val);
  });
  if (weatherData) renderWeather(weatherData);
}

async function showWeatherPage() {
  fadeOutThen(['mainContent', 'shareRow'], async () => {
    showState('weather');
    enterPage('weatherPage', 'page-enter-right');
    document.getElementById('weatherLocation').textContent = currentLocation?.name || '';
    document.getElementById('weatherBody').innerHTML =
      '<div style="text-align:center;padding:40px 0;"><div class="spinner"></div>' +
      '<div style="color:var(--text-dim);font-size:0.88rem;margin-top:8px;">Fetching weather…</div></div>';
    try {
      weatherData = await fetchWeather(currentLocation.lat, currentLocation.lon);
      renderWeather(weatherData);
    } catch(e) {
      document.getElementById('weatherBody').innerHTML =
        '<div style="color:var(--danger);text-align:center;padding:24px;">Failed to load weather data.</div>';
    }
  });
}

// ── Live Sync (Y.js + WebSocket — zero config, lazy-loaded) ────────────────────
const ydocs = {};     // code → { doc, ws, idb }
let applyingRemote = false;
let _yjsLoadPromise = null;

function ensureYjs() {
  if (_yjsLoadPromise) return _yjsLoadPromise;
  if (window.Y && window.yIndexeddb && window.yWebsocket) {
    return (_yjsLoadPromise = Promise.resolve(true));
  }
  _yjsLoadPromise = Promise.all([
    import('https://esm.sh/yjs@13.6.11'),
    import('https://esm.sh/y-indexeddb@9.0.10'),
    import('https://esm.sh/y-websocket@1.5.4'),
  ]).then(([Y, idb, ws]) => {
    window.Y          = Y;
    window.yIndexeddb = idb;
    window.yWebsocket = ws;
    return true;
  }).catch(err => {
    _yjsLoadPromise = null;
    throw err;
  });
  return _yjsLoadPromise;
}

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function goLive(famId) {
  const fam = families.find(f => f.id === famId);
  if (!fam) return;
  if (!fam.code) { fam.code = generateCode(); fam.isLive = true; saveFamilies(); }
  renderTracker(); // show spinner/badge immediately
  try {
    await ensureYjs();
    startYjsSync(fam);
    renderTracker();
  } catch(e) {
    console.warn('Y.js load failed:', e);
    alert('Could not connect to real-time sync. Check your internet connection.');
  }
}

async function joinFamilyByCode(code) {
  const joinInput = document.getElementById('joinCodeInput');
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!code) return;
  if (code.length < 6) { alert('Codes are 6 characters. Check the code and try again.'); return; }

  // Re-read localStorage so we catch families created in other tabs of this browser
  const fresh = JSON.parse(localStorage.getItem('mrr_families') || '[]');
  const localMatch = fresh.find(f => f.code === code);
  if (localMatch) {
    if (families.some(f => f.id === localMatch.id)) { alert('You are already in this family.'); return; }
    // Family exists in this browser (another tab is the host) — adopt it
    families = fresh;
    if (joinInput) joinInput.value = '';
    renderTracker();
    if (localMatch.isLive) {
      try { await ensureYjs(); startYjsSync(localMatch); renderTracker(); } catch(e) {}
    }
    return;
  }

  if (families.some(f => f.code === code)) { alert('You are already in this family.'); return; }

  // Cross-device join: create placeholder and wait for Y.js sync to deliver host data
  const id = 'fam_' + Date.now();
  const fam = { id, name: 'Joining…', members: [], isLive: true, code };
  families.push(fam);
  saveFamilies();
  if (joinInput) joinInput.value = '';
  renderTracker();
  try {
    await ensureYjs();
    startYjsSync(fam);
    renderTracker();
    // If no host data arrives within 20 s, the code doesn't exist on any device
    setTimeout(() => {
      const f = families.find(x => x.id === id);
      if (f && f.name === 'Joining…') {
        families = families.filter(x => x.id !== id);
        if (ydocs[code]) {
          try { ydocs[code].ws?.destroy(); ydocs[code].idb?.destroy(); } catch(e) {}
          delete ydocs[code];
        }
        saveFamilies();
        renderTracker();
        alert('Error: Family Not Found');
      }
    }, 20000);
  } catch(e) {
    console.warn('Y.js load failed:', e);
    families = families.filter(f => f.id !== id);
    saveFamilies();
    renderTracker();
    alert('Could not connect to real-time sync. Check your internet connection.');
  }
}

function startYjsSync(fam) {
  if (ydocs[fam.code]) return;
  const room = 'mrr-family-' + fam.code;
  const doc  = new Y.Doc();
  const idb  = new yIndexeddb.IndexeddbPersistence(room, doc);
  // y-websocket: connect to the official Y.js demo server — simple WebSocket,
  // no peer discovery or NAT traversal needed unlike WebRTC.
  const ws   = new yWebsocket.WebsocketProvider('wss://demos.yjs.dev', room, doc);
  ydocs[fam.code] = { doc, ws, idb };

  const yMeta     = doc.getMap('meta');
  const yMembers  = doc.getArray('members');
  const yTasks    = doc.getMap('tasks');
  const yProgress = doc.getMap('progress');

  const apply = () => applyYjsToLocal(fam.id, doc);

  yMembers.observe(apply);
  yTasks.observe(apply);
  yProgress.observe(apply);
  yMeta.observe(apply);

  // Re-apply whenever the WebSocket connects (catches initial server state)
  ws.on('status', ({ status }) => { if (status === 'connected') apply(); });

  // Once IndexedDB has loaded, push our own local state into the shared doc
  idb.on('synced', () => {
    doc.transact(() => {
      if (fam.name && fam.name !== 'Joining…' && !yMeta.get('name'))
        yMeta.set('name', fam.name);
      fam.members.forEach(name => {
        if (!yMembers.toArray().includes(name)) yMembers.push([name]);
        yTasks.set(name, getMemberTasks(name));
        getMemberTasks(name).forEach(t => {
          const key = name + '::' + t;
          if (!yProgress.has(key))
            yProgress.set(key, localStorage.getItem(memberItemKey(name, t)) === '1');
        });
      });
    }, 'local');
    apply();
  });
}

function applyYjsToLocal(famId, doc) {
  const fam = families.find(f => f.id === famId);
  if (!fam) return;
  const yMeta     = doc.getMap('meta');
  const yMembers  = doc.getArray('members');
  const yTasks    = doc.getMap('tasks');
  const yProgress = doc.getMap('progress');

  let changed = false;
  const remoteName = yMeta.get('name');
  if (remoteName && remoteName !== 'Joining…' && fam.name !== remoteName) {
    fam.name = remoteName;
    changed = true;
  }

  yMembers.toArray().forEach(name => {
    if (!fam.members.includes(name)) { fam.members.push(name); changed = true; }
  });
  if (changed) saveFamilies();

  applyingRemote = true;
  try {
    fam.members.forEach(name => {
      const tasks = yTasks.get(name);
      if (tasks) saveMemberTasks(name, tasks);
      getMemberTasks(name).forEach(t => {
        const val = yProgress.get(name + '::' + t);
        if (val !== undefined)
          localStorage.setItem(memberItemKey(name, t), val ? '1' : '0');
      });
    });
  } finally { applyingRemote = false; }

  renderTracker();
}

function pushProgressToYjs(fam, name) {
  if (!fam.isLive || !ydocs[fam.code] || applyingRemote) return;
  const { doc } = ydocs[fam.code];
  doc.transact(() => {
    getMemberTasks(name).forEach(t => {
      doc.getMap('progress').set(name + '::' + t,
        localStorage.getItem(memberItemKey(name, t)) === '1');
    });
  }, 'local');
}

function pushMemberToYjs(fam, name) {
  if (!fam.isLive || !ydocs[fam.code]) return;
  const { doc } = ydocs[fam.code];
  doc.transact(() => {
    const yMembers = doc.getArray('members');
    if (!yMembers.toArray().includes(name)) yMembers.push([name]);
    doc.getMap('tasks').set(name, getMemberTasks(name));
  }, 'local');
}

function copyFamilyCode(code) {
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector(`.code-btn[data-code="${code}"]`);
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}

// ── Main load flow ─────────────────────────────────────────────────────────────
async function loadRegion(lat, lon, name) {
  showState('loading');
  currentLocation = { lat, lon, name };

  const pill = document.getElementById('locationPill');
  pill.classList.remove('hidden');
  document.getElementById('pillName').textContent = name;
  document.getElementById('pillCoords').textContent = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;

  try {
    const [earthquakes, naturalEvents, alerts] = await Promise.all([
      fetchUSGS(lat, lon),
      fetchEONET(lat, lon),
      fetchNWSAlerts(lat, lon),
    ]);

    storedEarthquakes = earthquakes;
    storedNaturalEvents = naturalEvents;
    storedAlerts = alerts;
    allEvents = [...earthquakes, ...naturalEvents];

    cachedYears = YEARS_BACK;
    analysisYears = YEARS_BACK;
    analysisLabel = YEARS_BACK + '-yr';
    weatherData = null;

    showState('main');
    initMap(lat, lon);
    setupSlider(YEARS_BACK);

    // Reset picker to default on each new search
    document.getElementById('yrInput').value = YEARS_BACK;
    document.querySelectorAll('.yr-btn').forEach(b => b.classList.toggle('active', +b.dataset.yr === YEARS_BACK));
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('yrControl').dataset.loaded = '1';

    const risks = analyzeRisks(earthquakes, naturalEvents, alerts);
    renderRisks(risks);
    renderAlerts(alerts);
    renderChecklist(risks);
    renderTracker();
  } catch (err) {
    console.error(err);
    showError('Failed to load data', err.message || 'Check your connection and try again.');
  }
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
let acDebounce = null;
let acActiveIdx = -1;
let acResults = [];

function closeSuggestions() {
  document.getElementById('suggestionsDrop').classList.add('hidden');
  acActiveIdx = -1;
}

function highlightItem(idx) {
  const items = document.querySelectorAll('.suggestion-item');
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
  acActiveIdx = idx;
}

function formatSuggestion(r) {
  const parts = r.display_name.split(',').map(s => s.trim());
  const main = parts[0];
  const sub = parts.slice(1, 4).join(', ');
  const typeIcons = { city: '🏙️', town: '🏘️', village: '🏡', county: '🗺️', state: '📍', country: '🌍', suburb: '🏘️', municipality: '🏛️' };
  const icon = typeIcons[r.type] || typeIcons[r.addresstype] || '📍';
  return { main, sub, icon, lat: parseFloat(r.lat), lon: parseFloat(r.lon), fullName: parts.slice(0, 3).join(', ') };
}

async function fetchSuggestions(query) {
  if (query.length < 2) { closeSuggestions(); return; }
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=12&addressdetails=1&featuretype=settlement`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  acResults = data.map(formatSuggestion);
  renderSuggestions();
}

function renderSuggestions() {
  const drop = document.getElementById('suggestionsDrop');
  if (!acResults.length) { drop.classList.add('hidden'); return; }
  drop.innerHTML = acResults.map((s, i) => `
    <div class="suggestion-item" data-idx="${i}" onmousedown="pickSuggestion(${i})">
      <span class="sug-icon">${s.icon}</span>
      <div>
        <div class="sug-main">${s.main}</div>
        ${s.sub ? `<div class="sug-sub">${s.sub}</div>` : ''}
      </div>
    </div>`).join('');
  drop.classList.remove('hidden');
  acActiveIdx = -1;
}

function pickSuggestion(idx) {
  const s = acResults[idx];
  if (!s) return;
  document.getElementById('cityInput').value = s.main;
  closeSuggestions();
  loadRegion(s.lat, s.lon, s.fullName);
}

// ── Search / Geolocate ─────────────────────────────────────────────────────────
async function handleSearch() {
  const query = document.getElementById('cityInput').value.trim();
  if (!query) return;
  if (hasProfanity(query)) { showInputWarn('cityInput', 'Please keep your search clean.'); return; }
  closeSuggestions();
  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  try {
    const loc = await geocode(query);
    await loadRegion(loc.lat, loc.lon, loc.name);
  } catch (err) {
    showError('Location not found', err.message);
  } finally {
    btn.disabled = false;
  }
}

function handleGeolocate() {
  if (!navigator.geolocation) { showError('Not supported', 'Your browser does not support geolocation.'); return; }
  const btn = document.getElementById('geoBtn');
  btn.disabled = true; btn.textContent = '📍 Locating…';
  navigator.geolocation.getCurrentPosition(
    async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const name = await reverseGeocode(lat, lon);
        document.getElementById('cityInput').value = name;
        await loadRegion(lat, lon, name);
      } catch (err) { showError('Failed to load data', err.message); }
      finally { btn.disabled = false; btn.textContent = '📍 Use My Location'; }
    },
    () => { btn.disabled = false; btn.textContent = '📍 Use My Location'; showError('Access denied', 'Allow location access or enter a city manually.'); }
  );
}

// ── Share / Save ───────────────────────────────────────────────────────────────
function shareResults() {
  if (!currentLocation) return;
  const url = new URL(window.location.href);
  url.searchParams.set('q', currentLocation.name);
  url.searchParams.set('lat', currentLocation.lat.toFixed(4));
  url.searchParams.set('lon', currentLocation.lon.toFixed(4));
  if (navigator.share) {
    navigator.share({ title: `Risk Report: ${currentLocation.name}`, url: url.toString() });
  } else {
    navigator.clipboard.writeText(url.toString()).then(() => {
      const btn = document.getElementById('shareBtn');
      const orig = btn.textContent;
      btn.textContent = '✓ Link copied!';
      setTimeout(() => btn.textContent = orig, 2200);
    });
  }
}

function saveReport() {
  if (!currentLocation) return;
  const risksText = currentRisks.map(r => `  ${r.rank}. ${r.name} (score: ${r.score})`).join('\n');
  const text = [
    "MY REGION'S RISK REPORT",
    `Generated: ${new Date().toLocaleDateString()}`,
    `Location:  ${currentLocation.name}`,
    '',
    'TOP 3 RISKS',
    risksText,
    '',
    `EVENT COUNTS (${analysisYears}-year window)`,
    `  Earthquakes:   ${document.getElementById('statEq').textContent}`,
    `  Wildfires:     ${document.getElementById('statFire').textContent}`,
    `  Floods:        ${document.getElementById('statFlood').textContent}`,
    `  Active Alerts: ${document.getElementById('statAlerts').textContent}`,
  ].join('\n');

  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })),
    download: `risk-report-${currentLocation.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`,
  });
  a.click();
}

// ── Init ───────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  applyTranslations();
  (function () {
    const hint = document.getElementById('scrollHint');
    if (!hint) return;
    window.addEventListener('scroll', () => {
      hint.classList.toggle('faded', window.scrollY > 60);
    }, { passive: true });
  })();
  document.getElementById('familyInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFamily(); });
  document.getElementById('familyInput').addEventListener('input', e => { if (!hasProfanity(e.target.value)) hideInputWarn('familyInput'); });
  document.getElementById('joinCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinFamilyByCode(e.target.value); });
  // Reconnect any families that were already live (restores real-time sync on reload)
  const liveFamilies = families.filter(f => f.isLive && f.code);
  if (liveFamilies.length) {
    ensureYjs().then(() => {
      liveFamilies.forEach(startYjsSync);
      renderTracker();
    }).catch(e => console.warn('Y.js reconnect skipped:', e));
  }

  const yrInput = document.getElementById('yrInput');
  const commitYrInput = () => {
    const v = parseInt(yrInput.value);
    if (!isNaN(v)) setAnalysisYears(v);
  };
  yrInput.addEventListener('change', commitYrInput);
  yrInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitYrInput(); yrInput.blur(); } });

  const cityInput = document.getElementById('cityInput');

  cityInput.addEventListener('input', () => {
    clearTimeout(acDebounce);
    const q = cityInput.value.trim();
    if (!hasProfanity(q)) hideInputWarn('cityInput');
    if (!q) { closeSuggestions(); return; }
    acDebounce = setTimeout(() => fetchSuggestions(q), 280);
  });

  cityInput.addEventListener('keydown', e => {
    const items = document.querySelectorAll('.suggestion-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightItem(Math.min(acActiveIdx + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightItem(Math.max(acActiveIdx - 1, -1));
    } else if (e.key === 'Enter') {
      if (acActiveIdx >= 0 && acResults[acActiveIdx]) {
        e.preventDefault();
        pickSuggestion(acActiveIdx);
      } else {
        handleSearch();
      }
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  cityInput.addEventListener('blur', () => setTimeout(closeSuggestions, 150));

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-input-wrap')) closeSuggestions();
  });

  renderTracker();

  // Auto-load from shared URL
  const p = new URLSearchParams(window.location.search);
  const q = p.get('q'), lat = parseFloat(p.get('lat')), lon = parseFloat(p.get('lon'));
  if (q && !isNaN(lat) && !isNaN(lon)) {
    document.getElementById('cityInput').value = q;
    await loadRegion(lat, lon, q);
  }
});
