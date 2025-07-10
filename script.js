document.addEventListener('DOMContentLoaded', () => {
  // Registrar Service Worker
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

  // Manejadores de búsqueda
  const searchButton = document.getElementById('searchButton');
  searchButton.addEventListener('click', () => {
    getWeatherAndForecast();
  });

  const cityInput = document.getElementById('cityInput');
  cityInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      getWeatherAndForecast();
    }
  });

  // Aquí podrías agregar tu código de fondo animado si lo tienes
});

// Función auxiliar para obtener la dirección cardinal del viento
function getCardinalDirection(degrees) {
  const dirs = ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'];
  const index = Math.round(degrees / 45) % 8;
  return dirs[index];
}

async function getWeatherAndForecast() {
  const city = document.getElementById("cityInput").value.trim();
  if (!city) {
    document.getElementById("weatherResult").innerHTML = `<p class="error-message">Por favor, ingresa el nombre de una ciudad.</p>`;
    return;
  }

  const apiKey = "c4381f22c73ec16dc79729cec227af4e";
  const weatherResultContainer = document.getElementById("weatherResult");
  weatherResultContainer.innerHTML = '<p>Cargando datos...</p>';

  try {
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=es`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();

    if (!weatherResponse.ok) {
      throw new Error(weatherData.message || 'Ciudad no encontrada.');
    }

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
      (temp >= 15 && temp <= 30 && windKt < 20 && weatherData.visibility > 8000)
    );
    const weatherClass = isGood ? "good-weather" : "bad-weather";

    let weatherHtml = `
      <div class="weather-card ${weatherClass}">
        <h2><i class="fas fa-map-marker-alt"></i> ${weatherData.name}, ${weatherData.sys.country}</h2>
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

    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric&lang=es`;
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();

    if (!forecastResponse.ok) {
      throw new Error(forecastData.message || 'Error al obtener el pronóstico.');
    }

    let forecastHtml = `<h3><i class="fas fa-calendar-day"></i> Pronóstico para los próximos días</h3>`;

    const dailyForecasts = {};
    const today = new Date().toLocaleDateString("es-ES", { year: 'numeric', month: 'numeric', day: 'numeric' });

    forecastData.list.forEach(item => {
      const date = new Date(item.dt * 1000);
      const dateKey = date.toLocaleDateString("es-ES", { year: 'numeric', month: 'numeric', day: 'numeric' });
      const hour = date.getHours();

      if (dateKey !== today) {
        if (!dailyForecasts[dateKey] || (hour >= 12 && hour <= 15)) {
          dailyForecasts[dateKey] = item;
        }
      }
    });

    const upcomingDays = Object.values(dailyForecasts).slice(0, 3);

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

        forecastHtml += `
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
      forecastHtml += `<p>No se pudo obtener el pronóstico extendido.</p>`;
    }

    weatherResultContainer.innerHTML = weatherHtml + forecastHtml;

  } catch (error) {
    console.error("Error al obtener datos del clima:", error);
    weatherResultContainer.innerHTML = `<p class="error-message">Ocurrió un error: ${error.message}</p>`;
  }
}