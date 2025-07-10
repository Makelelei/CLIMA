const apiKey = "f70a765824msh7730a17cbe54bfep14a003jsn62e1d80c1e37";
const apiHost = "open-weather13.p.rapidapi.com";

document.getElementById('search-button').addEventListener('click', () => {
    const city = document.getElementById('city-input').value;
    if (city) {
        getWeather(city);
    }
});

async function getWeather(city) {
    const url = `https://${apiHost}/city/${encodeURIComponent(city)}`;

    const options = {
        method: 'GET',
        headers: {
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': apiHost
        }
    };

    try {
        const response = await fetch(url, options);
        const data = await response.json();
        displayWeather(data);
    } catch (error) {
        console.error('Error fetching weather data:', error);
    }
}

function displayWeather(data) {
    const weatherInfo = document.getElementById('weather-info');
    
    if (!data || !data.main || !data.weather || data.weather.length === 0) {
        weatherInfo.innerHTML = '<p>Weather data not available.</p>';
        return;
    }

    const city = data.name;
    const temp = data.main.temp;
    const humidity = data.main.humidity;
    const description = data.weather[0].description;
    const time = getLocalTime(data.dt, data.timezone); // UTC timestamp + timezone offset

    weatherInfo.innerHTML = `
        <h2>${city}</h2>
        <p><strong>Temperatura:</strong> ${temp}°C</p>
        <p><strong>Humedad:</strong> ${humidity}%</p>
        <p><strong>Descripción:</strong> ${description}</p>
        <p><strong>Hora local:</strong> ${time}</p>
    `;
}

function getLocalTime(unixTimestamp, timezoneOffsetSeconds) {
    const localTimeMs = (unixTimestamp + timezoneOffsetSeconds) * 1000;
    const localDate = new Date(localTimeMs);
    const hours = localDate.getUTCHours().toString().padStart(2, '0');
    const minutes = localDate.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}
