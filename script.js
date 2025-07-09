async function getWeather() {
  const city = document.getElementById("cityInput").value;
  const apiKey = "c4381f22c73ec16dc79729cec227af4e";
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=es`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      const iconCode = data.weather[0].icon;
      const iconUrl = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;

      const result = `
        <img src="${iconUrl}" alt="Clima">
        <h2>${data.name}, ${data.sys.country}</h2>
        <p><i class="fas fa-temperature-low"></i> Temp: ${data.main.temp} °C</p>
        <p><i class="fas fa-water"></i> Humedad: ${data.main.humidity}%</p>
        <p><i class="fas fa-wind"></i> Viento: ${data.wind.speed} km/h</p>
        <p><i class="fas fa-cloud"></i> Estado: ${data.weather[0].description}</p>
      `;
      document.getElementById("weatherResult").innerHTML = result;
    } else {
      document.getElementById("weatherResult").innerText = "Ciudad no encontrada.";
    }
  } catch (error) {
    console.error(error);
    document.getElementById("weatherResult").innerText = "Ocurrió un error al obtener los datos.";
  }
}