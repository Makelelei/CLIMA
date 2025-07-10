function getCardinalDirection(degrees) {
  const dirs = ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'];
  const index = Math.round(degrees / 45) % 8;
  return dirs[index];
}

async function getWeather() {
  const city = document.getElementById("cityInput").value;
  const apiKey = "c4381f22c73ec16dc79729cec227af4e";
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=es`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      const iconUrl = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
      const temp = data.main.temp;
      const humidity = data.main.humidity;
      const pressure = data.main.pressure;
      const visibility = data.visibility;
      const windKmh = data.wind.speed * 3.6;
      const windKt = (windKmh / 1.852).toFixed(2);
      const windDeg = data.wind.deg;
      const windDir = getCardinalDirection(windDeg);
      const description = data.weather[0].description.toLowerCase();

      const isGood = (
        description.includes("despejado") ||
        description.includes("cielo claro") ||
        (temp >= 18 && temp <= 27 && windKt < 15 && visibility > 7000)
      );
      const weatherClass = isGood ? "good-weather" : "bad-weather";

      const container = document.getElementById("weatherResult");
      container.className = "result";
      container.innerHTML = `
        <div class="weather-card ${weatherClass}">
          <h2><i class="fas fa-map-marker-alt"></i> ${data.name}, ${data.sys.country}</h2>
          <img src="${iconUrl}" alt="Clima">
          <p><i class="fas fa-thermometer-half"></i> Temp: ${temp} °C</p>
          <p><i class="fas fa-water"></i> Humedad: ${humidity}%</p>
          <p><i class="fas fa-tachometer-alt"></i> Presión: ${pressure} hPa</p>
          <p><i class="fas fa-eye"></i> Visibilidad: ${visibility} m</p>
          <p><i class="fas fa-wind"></i> Viento: ${windKmh.toFixed(2)} km/h (${windKt} kt)</p>
          <p><i class="fas fa-compass"></i> Dirección: ${windDeg}° (${windDir})</p>
          <p><i class="fas fa-cloud"></i> Estado: ${description}</p>
        </div>
      `;
    } else {
      document.getElementById("weatherResult").innerText = `Error: ${data.message}`;
    }
  } catch (error) {
    console.error("Error en getWeather:", error);
    document.getElementById("weatherResult").innerText = `Ocurrió un error: ${error.message}`;
  }
}

async function getForecast() {
  const city = document.getElementById("cityInput").value;
  const apiKey = "c4381f22c73ec16dc79729cec227af4e";
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric&lang=es`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      const forecastDiv = document.createElement("div");
      forecastDiv.innerHTML = `<h3><i class="fas fa-calendar-day"></i> Pronóstico próximo</h3>`;

      // Agrupar por día (fecha sin hora)
      const forecastByDay = {};
      data.list.forEach(item => {
        const dateOnly = item.dt_txt.split(" ")[0];
        if (!forecastByDay[dateOnly]) {
          forecastByDay[dateOnly] = item;
        }
      });

      // Tomar los siguientes 3 días (omitimos hoy)
      const dates = Object.keys(forecastByDay).slice(1, 4);
      dates.forEach(date => {
        const item = forecastByDay[date];
        const dateLabel = new Date(item.dt_txt).toLocaleDateString("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "short"
        });
        const temp = item.main.temp;
        const desc = item.weather[0].description.toLowerCase();
        const icon = item.weather[0].icon;
        const iconUrl = `https://openweathermap.org/img/wn/${icon}@2x.png`;
        const windKmh = item.wind.speed * 3.6;
        const windKt = (windKmh / 1.852).toFixed(1);
        const windDeg = item.wind.deg;
        const windDir = getCardinalDirection(windDeg);
        const blockClass = desc.includes("lluvia") || windKt > 20 ? "bad-weather" : "good-weather";

        forecastDiv.innerHTML += `
          <div class="forecast-block ${blockClass}">
            <h4><i class="fas fa-calendar-day"></i> ${dateLabel}</h4>
            <img src="${iconUrl}" alt="Icono clima">
            <p><i class="fas fa-thermometer-half"></i> ${temp} °C</p>
            <p><i class="fas fa-wind"></i> Viento: ${windKmh.toFixed(1)} km/h (${windKt} kt) desde ${windDir}</p>
            <p><i class="fas fa-cloud"></i> Estado: ${desc}</p>
          </div>
        `;
      });

      document.getElementById("weatherResult").appendChild(forecastDiv);
    } else {
      document.getElementById("weatherResult").innerText = `Error: ${data.message}`;
    }
  } catch (error) {
    console.error("Error en getForecast:", error);
    document.getElementById("weatherResult").innerText = `Ocurrió un error: ${error.message}`;
  }
}
