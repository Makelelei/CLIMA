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
