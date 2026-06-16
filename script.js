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
(function () {
  if (localStorage.getItem('mrr_theme') === 'light') {
    document.documentElement.classList.add('light');
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('themeToggle').textContent = '🌙 Dark';
    });
  }
})();

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('mrr_theme', isLight ? 'light' : 'dark');
  document.getElementById('themeToggle').textContent = isLight ? '🌙 Dark' : '☀️ Light';
}

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
  const picker = document.getElementById('langPicker');
  if (picker && !picker.contains(e.target))
    document.getElementById('langMenu').classList.add('hidden');
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
  const checklistBtn = document.getElementById('checklistBtn');
  const weatherBtn  = document.getElementById('weatherBtn');
  const disastersBtn = document.getElementById('disastersBtn');
  if (which === 'landing') {
    document.getElementById('landingPage').classList.remove('hidden');
    if (searchSection) searchSection.classList.add('hidden');
    backBtn.classList.add('hidden');
    checklistBtn.classList.add('hidden');
    weatherBtn.classList.add('hidden');
    disastersBtn?.classList.add('hidden');
    return;
  }
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
