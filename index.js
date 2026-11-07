import express from 'express';

import { google } from 'googleapis';
import 'dotenv/config';

const app = express();


const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);


app.get('/auth', (req, res) => {  

    const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: [
            "https://www.googleapis.com/auth/calendar"
        ],
        prompt: "consent",
    });

    console.log('url', url);

    res.redirect(url);
})

app.get('/callback', async (req, res) => {
    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);

    console.log(tokens);  

})
const PORT = 5000;
app.listen(PORT, () => {
      console.log("Server is running on port 5000");
      
})

