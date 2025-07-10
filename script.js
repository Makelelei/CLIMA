// Referencias a elementos del DOM
const cityInput = document.getElementById('cityInput');
const searchButton = document.getElementById('searchButton');
const citySuggestions = document.getElementById('citySuggestions');

// --- CONFIGURACIÓN DE LA API ---
const OPENWEATHER_API_KEY = "c4381f22c73ec16dc79729cec227af4e";
const GEOCODING_API_URL = 'https://api.openweathermap.org/geo/1.0/direct';
const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_API_URL = 'https://api.openweathermap.org/data/2.5/forecast';

let debounceTimeout;
let hourlyForecastData = [];

function getCardinalDirection(degrees) {
    const dirs = ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'];
    const index = Math.round(degrees / 45) % 8;
    return dirs[index];
}

function getLocalTime(unixTimestamp, timezoneOffsetSeconds) {
    const utcDate = new Date(unixTimestamp * 1000);
    const localTimeMs = utcDate.getTime() + (timezoneOffsetSeconds * 1000);
    const localDate = new Date(localTimeMs);
    const hours = localDate.getHours().toString().padStart(2, '0');
    const minutes = localDate.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

async function getWeatherAndForecast(cityOverride) {
    const city = cityOverride || cityInput.value.trim();

    if (!city) {
        document.getElementById("currentWeatherDisplay").innerHTML = `<p class="error-message">Por favor, ingresa el nombre de una ciudad.</p>`;
        document.getElementById("hourlyForecast").innerHTML = '';
        document.getElementById("dailyForecastDisplay").innerHTML = '';
        return;
    }

    const currentWeatherDisplay = document.getElementById("currentWeatherDisplay");
    const hourlyForecastContainer = document.getElementById("hourlyForecast");
    const dailyForecastDisplay = document.getElementById("dailyForecastDisplay");

    currentWeatherDisplay.innerHTML = '<p>Cargando clima actual...</p>';
    hourlyForecastContainer.innerHTML = '<p>Cargando pronóstico por horas...</p>';
    dailyForecastDisplay.innerHTML = '<p>Cargando pronóstico diario...</p>';

    try {
        const geoResponse = await fetch(`${GEOCODING_API_URL}?q=${city}&limit=1&appid=${OPENWEATHER_API_KEY}`);
        const geoData = await geoResponse.json();

        if (geoData.length === 0) throw new Error('Ciudad no encontrada.');

        const { lat, lon, name, state, country } = geoData[0];
        const fullLocationName = `${name}${state ? ', ' + state : ''}, ${country}`;
        cityInput.value = fullLocationName;

        const weatherResponse = await fetch(`${WEATHER_API_URL}?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`);
        const weatherData = await weatherResponse.json();
        if (!weatherResponse.ok) throw new Error(weatherData.message || 'Error al obtener clima actual.');

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

        currentWeatherDisplay.innerHTML = `
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

        const forecastResponse = await fetch(`${FORECAST_API_URL}?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`);
        const forecastData = await forecastResponse.json();
        if (!forecastResponse.ok) throw new Error(forecastData.message || 'Error al obtener pronóstico.');

        hourlyForecastData = forecastData.list;

        // --- Pronóstico por hora ---
        let hourlyHtml = `<h3><i class="fas fa-clock"></i> Pronóstico por Horas</h3><div class="hourly-grid">`;
        const now = new Date();
        let count = 0;

        for (let i = 0; i < hourlyForecastData.length && count < 8; i++) {
            const item = hourlyForecastData[i];
            const forecastDate = new Date(item.dt * 1000);
            if (forecastDate > now) {
                const hour = forecastDate.getHours().toString().padStart(2, '0');
                const temp = item.main.temp.toFixed(0);
                const desc = item.weather[0].description.toLowerCase();
                const iconUrl = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;
                const feels = item.main.feels_like.toFixed(1);
                const wind = (item.wind.speed * 3.6).toFixed(1);
                const windKt = (wind / 1.852).toFixed(1);
                const dir = getCardinalDirection(item.wind.deg);
                hourlyHtml += `
                    <div class="hourly-item ${desc.includes("lluvia") ? "bad-weather" : "good-weather"}" data-index="${i}">
                        <div class="hourly-summary">
                            <p class="hourly-time">${hour}:00</p>
                            <img src="${iconUrl}" alt="">
                            <p class="hourly-temp">${temp}°C</p>
                            <p class="hourly-desc">${desc.charAt(0).toUpperCase() + desc.slice(1)}</p>
                        </div>
                        <div class="hourly-details">
                            <p><i class="fas fa-thermometer-half"></i> Sensación térmica: ${feels} °C</p>
                            <p><i class="fas fa-water"></i> Humedad: ${item.main.humidity}%</p>
                            <p><i class="fas fa-tachometer-alt"></i> Presión: ${item.main.pressure} hPa</p>
                            <p><i class="fas fa-eye"></i> Visibilidad: ${(item.visibility / 1000).toFixed(1)} km</p>
                            <p><i class="fas fa-wind"></i> Viento: ${wind} km/h (${windKt} kt) desde ${dir}</p>
                        </div>
                    </div>
                `;
                count++;
            }
        }
        hourlyHtml += '</div>';
        hourlyForecastContainer.innerHTML = hourlyHtml;
        addHourlyClickEvents();

        // --- Pronóstico diario (mejorado con min/max) ---
        let dailyHtml = `<h3><i class="fas fa-calendar-day"></i> Pronóstico para los próximos días</h3>`;
        const groupedByDay = {};

        hourlyForecastData.forEach(item => {
            const date = new Date(item.dt_txt);
            const dayKey = date.toISOString().split('T')[0];
            if (!groupedByDay[dayKey]) {
                groupedByDay[dayKey] = [];
            }
            groupedByDay[dayKey].push(item);
        });

        const todayKey = new Date().toISOString().split('T')[0];
        const nextDays = Object.entries(groupedByDay)
            .filter(([key]) => key !== todayKey)
            .slice(0, 3);

        nextDays.forEach(([dateKey, entries]) => {
            let min = Infinity, max = -Infinity;
            let chosenEntry = entries[Math.floor(entries.length / 2)];

            entries.forEach(entry => {
                const t = entry.main.temp;
                if (t < min) min = t;
                if (t > max) max = t;
            });

            const dateLabel = new Date(chosenEntry.dt_txt).toLocaleDateString("es-ES", {
                weekday: "long", day: "numeric", month: "short"
            });

            const desc = chosenEntry.weather[0].description.toLowerCase();
            const icon = chosenEntry.weather[0].icon;
            const wind = (chosenEntry.wind.speed * 3.6).toFixed(1);
            const windKt = (wind / 1.852).toFixed(1);
            const dir = getCardinalDirection(chosenEntry.wind.deg);
            const blockClass = desc.includes("lluvia") || parseFloat(windKt) > 20 ? "bad-weather" : "good-weather";

            dailyHtml += `
                <div class="forecast-block ${blockClass}">
                    <h4><i class="fas fa-calendar-day"></i> ${dateLabel}</h4>
                    <img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="Icono">
                    <p><i class="fas fa-thermometer-quarter"></i> Mín: ${min.toFixed(1)} °C</p>
                    <p><i class="fas fa-thermometer-three-quarters"></i> Máx: ${max.toFixed(1)} °C</p>
                    <p><i class="fas fa-wind"></i> Viento: ${wind} km/h (${windKt} kt) desde ${dir}</p>
                    <p><i class="fas fa-cloud"></i> Estado: ${desc.charAt(0).toUpperCase() + desc.slice(1)}</p>
                </div>
            `;
        });

        dailyForecastDisplay.innerHTML = dailyHtml;

    } catch (error) {
        console.error(error);
        currentWeatherDisplay.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
        hourlyForecastContainer.innerHTML = '';
        dailyForecastDisplay.innerHTML = '';
    }
}

function addHourlyClickEvents() {
    document.querySelectorAll('.hourly-item').forEach(item => {
        item.addEventListener('click', () => {
            item.classList.toggle('expanded');
        });
    });
}

async function displayCitySuggestions(filterText = '') {
    citySuggestions.innerHTML = '';
    citySuggestions.style.display = 'none';

    if (filterText.length < 3) return;
    clearTimeout(debounceTimeout);

    debounceTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${GEOCODING_API_URL}?q=${filterText}&limit=5&appid=${OPENWEATHER_API_KEY}`);
            const data = await response.json();

            if (data.length > 0) {
                citySuggestions.style.display = 'block';
                data.forEach(loc => {
                    const item = document.createElement('div');
                    item.classList.add('city-suggestion-item');
                    const name = `${loc.name}${loc.state ? ', ' + loc.state : ''}, ${loc.country}`;
                    item.textContent = name;
                    item.addEventListener('mousedown', e => {
                        e.preventDefault();
                        cityInput.value = name;
                        citySuggestions.style.display = 'none';
                        getWeatherAndForecast(name);
                    });
                    citySuggestions.appendChild(item);
                });
            }
        } catch (error) {
            console.error('Error al obtener sugerencias:', error);
        }
    }, 300);
}

// --- EVENTOS ---

document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js')
            .then(r => console.log('SW registrado:', r.scope))
            .catch(e => console.error('Error al registrar SW:', e));
    }

    if (cityInput.value) getWeatherAndForecast();

    cityInput.addEventListener('focus', () => {
        if (cityInput.value.length >= 3) displayCitySuggestions(cityInput.value);
    });

    cityInput.addEventListener('blur', () => {
        setTimeout(() => citySuggestions.style.display = 'none', 100);
    });

    cityInput.addEventListener('input', () => displayCitySuggestions(cityInput.value));

    searchButton.addEventListener('click', () => {
        if (cityInput.value) getWeatherAndForecast(cityInput.value);
    });

    cityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && cityInput.value) getWeatherAndForecast(cityInput.value);
    });
});
