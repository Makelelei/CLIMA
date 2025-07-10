// Referencias a elementos del DOM
const cityInput = document.getElementById('cityInput');
const searchButton = document.getElementById('searchButton');
const citySuggestions = document.getElementById('citySuggestions'); // Nuevo elemento para sugerencias

// --- CONFIGURACIÓN DE LA API ---
const OPENWEATHER_API_KEY = "c4381f22c73ec16dc79729cec227af4e"; // Tu clave API de OpenWeatherMap
const GEOCODING_API_URL = 'https://api.openweathermap.org/geo/1.0/direct'; // API de Geocodificación
const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather'; // API del clima actual
const FORECAST_API_URL = 'https://api.openweathermap.org/data/2.5/forecast'; // API de pronóstico

// Variable para controlar el "debounce" en las sugerencias
let debounceTimeout;

// Función auxiliar para obtener la dirección cardinal del viento
function getCardinalDirection(degrees) {
    const dirs = ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'];
    const index = Math.round(degrees / 45) % 8;
    return dirs[index];
}

/**
 * Obtiene la hora local de una ciudad dado su timestamp UTC y su offset de zona horaria.
 * @param {number} unixTimestamp - El timestamp UTC de la ciudad (en segundos).
 * @param {number} timezoneOffsetSeconds - El desplazamiento de la zona horaria en segundos desde UTC.
 * @returns {string} La hora local formateada (HH:MM).
 */
function getLocalTime(unixTimestamp, timezoneOffsetSeconds) {
    // Crea una fecha UTC a partir del timestamp
    const utcDate = new Date(unixTimestamp * 1000); // Convertir segundos a milisegundos

    // Aplica el desplazamiento de la zona horaria
    const localTimeMs = utcDate.getTime() + (timezoneOffsetSeconds * 1000);
    const localDate = new Date(localTimeMs);

    // Formatea la hora
    const hours = localDate.getUTCHours().toString().padStart(2, '0');
    const minutes = localDate.getUTCMinutes().toString().padStart(2, '0');

    return `${hours}:${minutes}`;
}


/**
 * Función principal para obtener y mostrar el clima y pronóstico.
 * Ahora puede ser llamada con una ciudad específica (desde sugerencias)
 * o tomar el valor del input (desde botón/enter).
 * @param {string} [cityOverride] - Opcional. Si se proporciona, usa esta ciudad en lugar del input.
 */
async function getWeatherAndForecast(cityOverride) {
    const city = cityOverride || cityInput.value.trim(); // Usa cityOverride si existe, de lo contrario, el valor del input

    if (!city) {
        document.getElementById("currentWeatherDisplay").innerHTML = `<p class="error-message">Por favor, ingresa el nombre de una ciudad.</p>`;
        document.getElementById("hourlyForecast").innerHTML = '';
        document.getElementById("dailyForecastDisplay").innerHTML = '';
        return;
    }

    console.log(`Buscando clima para: ${city}`);

    const currentWeatherDisplay = document.getElementById("currentWeatherDisplay");
    const hourlyForecastContainer = document.getElementById("hourlyForecast");
    const dailyForecastDisplay = document.getElementById("dailyForecastDisplay");

    // Limpiar todos los contenedores al inicio de una nueva búsqueda
    currentWeatherDisplay.innerHTML = '<p>Cargando clima actual...</p>';
    hourlyForecastContainer.innerHTML = '<p>Cargando pronóstico por horas...</p>';
    dailyForecastDisplay.innerHTML = '<p>Cargando pronóstico diario...</p>';

    try {
        // 1. Obtener coordenadas y nombre completo de la ciudad usando la API de Geocodificación
        const geoResponse = await fetch(`${GEOCODING_API_URL}?q=${city}&limit=1&appid=${OPENWEATHER_API_KEY}`);
        const geoData = await geoResponse.json();

        if (geoData.length === 0) {
            throw new Error('Ciudad no encontrada. Intenta con otro nombre.');
        }

        const { lat, lon, name, state, country } = geoData[0];
        // Construye el nombre completo de la ubicación para mostrarlo en la UI y el input
        const fullLocationName = `${name}${state ? ', ' + state : ''}, ${country}`;

        // Actualizar el input con el nombre completo y limpio de la ciudad seleccionada
        cityInput.value = fullLocationName;

        // --- FETCH CLIMA ACTUAL ---
        const weatherUrl = `${WEATHER_API_URL}?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`;
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();

        if (!weatherResponse.ok) {
            throw new Error(weatherData.message || 'Error al obtener el clima actual.');
        }

        // Obtener la hora local de la ciudad
        const localTime = getLocalTime(weatherData.dt, weatherData.timezone);

        const iconUrl = `https://openweathermap.org/img/wn/${weatherData.weather[0].icon}@2x.png`;
        const temp = weatherData.main.temp;
        const humidity = weatherData.main.humidity;
        const pressure = weatherData.main.pressure;
        const visibilityKm = (weatherData.visibility / 1000).toFixed(1);
        const windKmh = (weatherData.wind.speed * 3.6).toFixed(1);
        const windKt = (windKmh / 1.852).toFixed(1);
        const windDeg = weatherData.wind.deg;
        const windDir = getCardinalDirection(windDeg);
        const description = weatherData.weather[0].description.toLowerCase();

        const isGood = (
            description.includes("despejado") ||
            description.includes("cielo claro") ||
            (temp >= 15 && temp <= 30 && parseFloat(windKt) < 20 && weatherData.visibility > 8000)
        );
        const weatherClass = isGood ? "good-weather" : "bad-weather";

        // Generar HTML del clima actual, incluyendo la hora local
        let weatherHtml = `
            <div class="weather-card ${weatherClass}">
                <h2><i class="fas fa-map-marker-alt"></i> ${fullLocationName} <span class="local-time">(${localTime} Local)</span></h2>
                <img src="${iconUrl}" alt="Clima">
                <p><i class="fas fa-thermometer-half"></i> Temp: ${temp} °C</p>
                <p><i class="fas fa-water"></i> Humedad: ${humidity}%</p>
                <p><i class="fas fa-tachometer-alt"></i> Presión: ${pressure} hPa</p>
                <p><i class="fas fa-eye"></i> Visibilidad: ${visibilityKm} km</p>
                <p><i class="fas fa-wind"></i> Viento: ${windKmh} km/h (${windKt} kt)</p>
                <p><i class="fas fa-compass"></i> Dirección: ${windDeg}° (${windDir})</p>
                <p><i class="fas fa-cloud"></i> Estado: ${description.charAt(0).toUpperCase() + description.slice(1)}</p>
            </div>
        `;
        currentWeatherDisplay.innerHTML = weatherHtml;


        // --- FETCH PRONÓSTICO (5 días / 3 horas) ---
        const forecastUrl = `${FORECAST_API_URL}?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`;
        const forecastResponse = await fetch(forecastUrl);
        const forecastData = await forecastResponse.json();

        if (!forecastResponse.ok) {
            throw new Error(forecastData.message || 'Error al obtener el pronóstico.');
        }

        // --- Generar Pronóstico por Horas ---
        let hourlyHtml = `<h3><i class="fas fa-clock"></i> Pronóstico por Horas</h3><div class="hourly-grid">`;
        const now = new Date();
        let count = 0;

        for (let i = 0; i < forecastData.list.length; i++) {
            const item = forecastData.list[i];
            const forecastDate = new Date(item.dt * 1000);

            // Muestra las próximas 8 franjas horarias disponibles después de la hora actual
            if (forecastDate > now && count < 8) {
                const hour = forecastDate.getHours();
                const timeLabel = `${hour.toString().padStart(2, '0')}:00`;
                const tempHourly = item.main.temp.toFixed(0);
                const descHourly = item.weather[0].description.toLowerCase();
                const iconHourly = item.weather[0].icon;
                const iconUrlHourly = `https://openweathermap.org/img/wn/${iconHourly}.png`;

                hourlyHtml += `
                    <div class="hourly-item ${descHourly.includes("lluvia") ? "bad-weather" : "good-weather"}">
                        <p class="hourly-time">${timeLabel}</p>
                        <img src="https://openweathermap.org/img/wn/${iconUrlHourly}" alt="Icono clima hora">
                        <p class="hourly-temp">${tempHourly}°C</p>
                        <p class="hourly-desc">${descHourly.charAt(0).toUpperCase() + descHourly.slice(1)}</p>
                    </div>
                `;
                count++;
            }
        }
        hourlyHtml += `</div>`;
        hourlyForecastContainer.innerHTML = hourlyHtml;


        // --- Generar Pronóstico para los próximos días ---
        let dailyHtml = `<h3><i class="fas fa-calendar-day"></i> Pronóstico para los próximos días</h3>`;

        const dailyForecasts = {};
        const today = new Date().toLocaleDateString("es-ES", { year: 'numeric', month: 'numeric', day: 'numeric' });

        forecastData.list.forEach(item => {
            const date = new Date(item.dt * 1000);
            const dateKey = date.toLocaleDateString("es-ES", { year: 'numeric', month: 'numeric', day: 'numeric' });
            const hour = date.getHours();

            if (dateKey !== today) {
                // Selecciona una entrada por día, preferiblemente cerca del mediodía para una mejor representación diaria
                if (!dailyForecasts[dateKey] || (hour >= 12 && hour <= 15)) {
                    dailyForecasts[dateKey] = item;
                }
            }
        });

        const upcomingDays = Object.values(dailyForecasts).slice(0, 3); // Obtener los próximos 3 días

        if (upcomingDays.length > 0) {
            upcomingDays.forEach(item => {
                const dateLabel = new Date(item.dt_txt).toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "short"
                });
                const temp = item.main.temp.toFixed(1);
                const desc = item.weather[0].description.toLowerCase();
                const icon = item.weather[0].icon;
                const iconUrlForecast = `https://openweathermap.org/img/wn/${icon}@2x.png`;
                const windKmhForecast = (item.wind.speed * 3.6).toFixed(1);
                const windKtForecast = (windKmhForecast / 1.852).toFixed(1);
                const windDegForecast = item.wind.deg;
                const windDirForecast = getCardinalDirection(windDegForecast);
                const blockClass = desc.includes("lluvia") || parseFloat(windKtForecast) > 20 ? "bad-weather" : "good-weather";

                dailyHtml += `
                    <div class="forecast-block ${blockClass}">
                        <h4><i class="fas fa-calendar-day"></i> ${dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</h4>
                        <img src="${iconUrlForecast}" alt="Icono clima">
                        <p><i class="fas fa-thermometer-half"></i> Temp: ${temp} °C</p>
                        <p><i class="fas fa-wind"></i> Viento: ${windKmhForecast} km/h (${windKtForecast} kt) desde ${windDirForecast}</p>
                        <p><i class="fas fa-cloud"></i> Estado: ${desc.charAt(0).toUpperCase() + desc.slice(1)}</p>
                    </div>
                `;
            });
        } else {
            dailyHtml += `<p>No se pudo obtener el pronóstico extendido.</p>`;
        }

        dailyForecastDisplay.innerHTML = dailyHtml;

    } catch (error) {
        console.error("Error al obtener datos del clima:", error);
        currentWeatherDisplay.innerHTML = `<p class="error-message">Ocurrió un error: ${error.message}</p>`;
        hourlyForecastContainer.innerHTML = '';
        dailyForecastDisplay.innerHTML = '';
    }
}

/**
 * Muestra las sugerencias de ciudades obtenidas de la API de Geocodificación de OpenWeatherMap.
 * Aplica un debounce para no hacer demasiadas peticiones al escribir.
 * @param {string} filterText - El texto que el usuario ha escrito en el campo de búsqueda.
 */
async function displayCitySuggestions(filterText = '') {
    citySuggestions.innerHTML = ''; // Limpia sugerencias anteriores
    citySuggestions.style.display = 'none'; // Oculta el contenedor por defecto

    // Solo busca si hay al menos 3 caracteres para evitar demasiadas peticiones y resultados genéricos
    if (filterText.length < 3) {
        return;
    }

    // Limpia el timeout anterior para evitar llamadas duplicadas o innecesarias
    clearTimeout(debounceTimeout);

    // Establece un nuevo timeout para hacer la petición después de 300ms de inactividad
    debounceTimeout = setTimeout(async () => {
        try {
            // Realiza la petición a la API de Geocodificación con el texto del usuario
            const response = await fetch(`${GEOCODING_API_URL}?q=${filterText}&limit=5&appid=${OPENWEATHER_API_KEY}`);
            const data = await response.json();

            if (data.length > 0) {
                citySuggestions.style.display = 'block'; // Muestra el contenedor de sugerencias
                data.forEach(location => {
                    const suggestionItem = document.createElement('div');
                    suggestionItem.classList.add('city-suggestion-item');
                    // Construye el nombre completo de la ubicación para la sugerencia
                    const locationName = `${location.name}${location.state ? ', ' + location.state : ''}, ${location.country}`;
                    suggestionItem.textContent = locationName;

                    // Maneja el clic en una sugerencia
                    suggestionItem.addEventListener('mousedown', (e) => {
                        e.preventDefault(); // Previene que el input pierda el foco inmediatamente
                        cityInput.value = locationName; // Pone la ciudad seleccionada en el input
                        citySuggestions.style.display = 'none'; // Oculta las sugerencias
                        getWeatherAndForecast(locationName); // Llama a la función para buscar el clima de la ciudad seleccionada
                    });
                    citySuggestions.appendChild(suggestionItem);
                });
            } else {
                citySuggestions.style.display = 'none'; // Oculta si no hay resultados
            }
        } catch (error) {
            console.error('Error al obtener sugerencias de ciudades:', error);
            citySuggestions.style.display = 'none';
        }
    }, 300); // Debounce de 300ms
}

// --- MANEJADORES DE EVENTOS ---

document.addEventListener('DOMContentLoaded', () => {
    // Registrar Service Worker (tu código original)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('ServiceWorker registrado con éxito:', registration.scope);
                })
                .catch(error => {
                    console.error('Fallo al registrar ServiceWorker:', error);
                });
        });
    }

    // Si el input ya tiene un valor predeterminado al cargar (ej. "Buenos Aires..."),
    // busca el clima para esa ciudad automáticamente.
    if (cityInput.value) {
        getWeatherAndForecast();
    }

    // Muestra las sugerencias al enfocar el input
    cityInput.addEventListener('focus', () => {
        // Si el input tiene al menos 3 caracteres al enfocar, muestra sugerencias.
        // Si está vacío, no se mostrarán sugerencias de la API hasta que el usuario empiece a escribir.
        if (cityInput.value.length >= 3) {
            displayCitySuggestions(cityInput.value);
        }
    });

    // Oculta las sugerencias cuando el input pierde el foco
    cityInput.addEventListener('blur', () => {
        // Pequeño retraso para permitir que el evento 'mousedown' en una sugerencia se dispare antes de ocultar
        setTimeout(() => {
            citySuggestions.style.display = 'none';
        }, 100);
    });

    // Filtra y muestra sugerencias mientras el usuario escribe
    cityInput.addEventListener('input', () => {
        displayCitySuggestions(cityInput.value);
    });

    // Evento para el botón de búsqueda
    searchButton.addEventListener('click', () => {
        const city = cityInput.value;
        if (city) {
            getWeatherAndForecast(city); // Llama a la función con el valor actual del input
            citySuggestions.style.display = 'none'; // Oculta las sugerencias después de buscar
        } else {
            console.log("Por favor, ingresa una ciudad.");
            // Aquí podrías mostrar un mensaje de error visible al usuario
        }
    });

    // Evento para la tecla 'Enter' en el campo de entrada
    cityInput.addEventListener('keypress', (event) => { // Usando keypress como en tu original
        if (event.key === 'Enter') {
            const city = cityInput.value;
            if (city) {
                getWeatherAndForecast(city); // Llama a la función con el valor actual del input
                citySuggestions.style.display = 'none'; // Oculta las sugerencias después de buscar
            } else {
                console.log("Por favor, ingresa una ciudad.");
                // Aquí podrías mostrar un mensaje de error visible al usuario
            }
        }
    });
});
