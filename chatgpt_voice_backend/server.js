const express = require('express');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('./config');

const app = express();
const port = 3000;

const recordFile = path.resolve("./resources/recording.wav");
const voicedFile = path.resolve("./resources/voicedby.wav");

const apiKey = config.apiKey;
let shouldDownloadFile = false;
const maxTokens = 30;

const openai = new OpenAI({ apiKey: apiKey });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/resources', express.static(path.join(__dirname, 'resources')));

app.post('/uploadAudio', async (req, res) => {
    const startTotalTime = Date.now();
    shouldDownloadFile = false;
    const recordingFile = fs.createWriteStream(recordFile, { encoding: "utf8" });

    req.on('data', function (data) {
        recordingFile.write(data);
    });

    req.on('end', async function () {
        recordingFile.end();
        const transcription = await speechToTextAPI();
        const { gptResponse, gptResponseTime } = await callGPT(transcription);
        const endTotalTime = Date.now();
        const totalTime = endTotalTime - startTotalTime;
        
        await updateSignalDataFile();
        
        console.log('ChatGPT:', gptResponse);
        console.log('ChatGPT Response Time:', gptResponseTime, 'ms');
        console.log(`Total Response Time: ${totalTime} ms`);
        
        res.status(200).json({ transcription, gptResponse, gptResponseTime, totalTime });
    });
});

app.get('/checkVariable', (req, res) => {
    res.json({ ready: shouldDownloadFile });
});

app.get('/broadcastAudio', (req, res) => {
    fs.stat(voicedFile, (err, stats) => {
        if (err) {
            console.error('File not found');
            res.sendStatus(404);
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Content-Length': stats.size
        });

        const readStream = fs.createReadStream(voicedFile);
        readStream.pipe(res);

        readStream.on('end', () => {});
        readStream.on('error', (err) => {
            console.error('Error reading file', err);
            res.sendStatus(500);
        });
    });
});

app.get('/', async (req, res) => {
    try {
        const transcription = await speechToTextAPI();
        const { gptResponse, gptResponseTime } = await callGPT(transcription);

        const htmlContent = fs.readFileSync(path.join(__dirname, 'views', 'index.html'), 'utf8')
            .replace('{{transcription}}', transcription)
            .replace('{{gptResponse}}', gptResponse)
            .replace('{{gptResponseTime}}', gptResponseTime);

        res.send(htmlContent);
    } catch (error) {
        console.error('Error:', error);
        res.sendStatus(500);
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});

async function speechToTextAPI() {
    try {
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(recordFile),
            model: "whisper-1",
            response_format: "text"
        });

        console.log('YOU:', transcription);
        return transcription;
    } catch (error) {
        console.error('Error in speechToTextAPI:', error.message);
        return null;
    }
}

async function callGPT(text) {
    try {
        const message = {
            role: "user",
            content: text
        };

        const startTime = Date.now();
        const completion = await openai.chat.completions.create({
            messages: [message],
            model: "gpt-3.5-turbo",
            max_tokens: maxTokens
        });
        const endTime = Date.now();

        const gptResponse = completion.choices[0].message.content;
        const gptResponseTime = endTime - startTime;

        await GptResponsetoSpeech(gptResponse);

        return { gptResponse, gptResponseTime };

    } catch (error) {
        console.error('Error calling GPT:', error.response.data);
        return { gptResponse: 'Error generating response from ChatGPT.', gptResponseTime: 0 };
    }
}

async function GptResponsetoSpeech(gptResponse) {
    try {
        const wav = await openai.audio.speech.create({
            model: "tts-1",
            voice: "echo",
            input: gptResponse,
            response_format: "wav",
        });

        const buffer = Buffer.from(await wav.arrayBuffer());
        await fs.promises.writeFile(voicedFile, buffer);

        shouldDownloadFile = true;
    } catch (error) {
        console.error("Error saving audio file:", error);
    }
}

async function updateSignalDataFile() {
    try {
        const buffer = fs.readFileSync(recordFile);
        const wav = require('node-wav');
        const result = wav.decode(buffer);
        const signal = Array.from(result.channelData[0]);
        const sampleRate = result.sampleRate;
        const duration = signal.length / sampleRate;

        const files = fs.readdirSync('./resources').filter(file => file.startsWith('signal_data'));
        const newFilename = `signal_data_chat${files.length + 1}.json`;
        const signalData = { signal, sampleRate, duration };
        const signalJsonPath = path.resolve(`./resources/${newFilename}`);
        fs.writeFileSync(signalJsonPath, JSON.stringify(signalData));
        console.log(`Saved signal data to ${newFilename}`);
    } catch (error) {
        console.error('Error updating signal data file:', error);
    }
}
