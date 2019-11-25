var express = require('express')
var router = express.Router({mergeParams: true});

const SendOtp = require('sendotp');
const sendOtp = new SendOtp('201993AhfXTDCNZ6OR5aa3a3a5');
const sendEmail = require('../../utils/sendEmail')

const TravelPlan = require('../../models/TravelPlan')
const User = require('../../models/User')

router.get('/session', async (req, res) => {
    let travelPlan = await TravelPlan.findOne({ idSession : req.sessionID });
    return res.send({ success: "Session exists!", sessionID: req.sessionID, travelPlan });
});

/**
 * POST /signup
 * Generate OTP to verify mobile.
 * Also send email to email
 */
router.post('/signup', async (req, res) => {

    if(!req.body.phone || ( (req.body.phone.toString()).length !== 10 )) return res.send({ error: "Invalid phone number!" })
    req.assert('password', 'Password cannot be blank').notEmpty();
    req.assert('name', 'Name cannot be blank').notEmpty();
    req.assert('email', 'Email is not valid').isEmail();
    req.sanitize('email').normalizeEmail({
        gmail_remove_dots: false
    })
    const errors = req.validationErrors();
    if (errors) return res.send({ error : "Error in signup!", errors });

    let existingUserPhone = await User.findOne({ phone: req.body.phone, verified: true })
    if(existingUserPhone) return res.send({ error : "This phone number is already registered!" });
    let existingUserEmail = await User.findOne({ email: req.body.email })
    if(existingUserEmail && existingUserEmail.verified) return res.send({ error : "This email ID is already registered!" });

    let otp = Math.floor(1000 + Math.random() * 9000)

    sendOtp.send('91'+req.body.phone, 'SMVIND', otp, async (err, data, response) => {
        if (err) return res.send({ error : err })
        if (data.type !== 'success') return res.send({error : "Could not send OTP. Please retry!"})

        let existingUser = existingUserEmail;
        if (existingUser) {
            existingUser.phone = req.body.phone
            existingUser.email = req.body.email
            existingUser.password = req.body.password
            existingUser.otp = otp
            await existingUser.save()
        } else {
            req.body.roles = ['travelPlanManager']
            req.body.otp = otp
            await User.create(req.body)
        }

        return res.send({ success: "OTP sent!", phone: req.body.phone })
    })
})

/**
 * POST /resend-signup-otp
 * Resend OTP to verify mobile.
 */
router.post('/resend-signup-otp', async (req, res) => {

    if(!req.body.phone || ( (req.body.phone.toString()).length !== 10 )) return res.send({ error: "Invalid phone number!" })

    let existingUser = await User.findOne({ phone: req.body.phone })
    if(!existingUser) return res.send({ error : "This phone number is not regiestered!" });
    if(existingUser.verified === true || existingUser.verified === 'true') return res.send({ error : "This phone number is already verified!" });
    
    let otp = Math.floor(1000 + Math.random() * 9000)
    
    sendOtp.send('91'+req.body.phone, 'SMVIND', otp, async (err, data, response) => {
        if(err) return res.send({error : err})
        if (data.type !== 'success') return res.send({error : "Could not send OTP. Please retry!"})
        
        existingUser.otp = otp
        await existingUser.save()
        
        return res.send({ success: "OTP resent!", phone: existingUser.phone })
    })
})

/**
 * POST /verify-signup-otp
 * Verify OTP sent by user.
 */
router.post('/verify-signup-otp', async (req, res, next) => {

    if(!req.body.phone || ( (req.body.phone.toString()).length !== 10 )) return res.send({ error: "Invalid phone number!" });

    let existingUser = await User.findOne({ phone : req.body.phone }).sort({createdAt: -1});
    if (!existingUser) return res.send({ error: "No OTP was sent to this phone!" });
    if (existingUser.verified === true || existingUser.verified === 'true') return res.send({ error: "This phone number is already verified!" });

    console.log("logging user", existingUser);

    if (existingUser.otp !== Number(req.body.otp)) return res.send({ error: "Incorrect OTP!"});

    console.log("logging session", req.sessionID);
    let travelPlan = await TravelPlan.findOne({ idSession : req.sessionID });
    if (travelPlan) {
        console.log("Logging travel plan id", travelPlan._id);
        travelPlan.idTravelPlanManagers = [ existingUser._id ];
        await travelPlan.save();
    }

    req.logIn(existingUser, async (err) => {
        if (err) return res.send({ error: "Internal server error in login."});
        existingUser.otp = null;
        existingUser.verified = true;
        await existingUser.save();
        await User.remove({ phone: req.body.phone, verified: { $ne : true } });
        return res.send({ success: "Phone verified and logged in!", user: existingUser});
    });
});

/**
 * POST /otp-login
 * Generate OTP to verify mobile no.
 * Also send email to email ID
 */
router.post('/login-with-otp', async (req, res) => {

    let existingUser

    if(req.body.phone) {
        existingUser = await User.findOne({ phone: req.body.phone, verified: true });
        if(!existingUser) return res.send({ error: "This phone number is not registered!" });
    }

    if(req.body.email) {
        existingUser = await User.findOne({ email: req.body.email, verified: true });
        if(!existingUser) return res.send({ error: "This email ID is not registered!" });
    }

    let otp = Math.floor(1000 + Math.random() * 9000)
    sendOtp.send('91'+existingUser.phone, 'SMVIND', otp, async (err, data, response) => {
        if(err) return res.send({error : err})
        if (data.type !== 'success') return res.send({error : "Could not send OTP. Please retry!"})
        let email = await sendEmail.to(
            existingUser.email,
            "OPT for logging in at StampMyVisa",
            "Your otp is "+otp+". Please do not share with anybody."
        )

        let message = email ? "OTP sent to both email and phone!" : "OTP sent only to phone!"

        existingUser.otp = otp
        await existingUser.save();

        return res.send({ success: message, existingUser })
    })
})

/**
 * POST /verify-login-otp
 * Verify OTP sent by user.
 */
router.post('/verify-login-otp', async (req, res, next) => {

    if(!req.body.phone || ( (req.body.phone.toString()).length !== 10 )) return res.send({ error: "Invalid phone number!" });

    let existingUser = await User.findOne({ phone : req.body.phone, verified: true });
    if (!existingUser) return res.send({ error: "No OTP was sent to this phone!" });

    if (existingUser.otp !== Number(req.body.otp)) return res.send({ error: "Incorrect OTP!"});

    req.logIn(existingUser, async (err) => {
        if (err) return res.send({ error: "Internal server error in login."});
        existingUser.otp = null;
        await existingUser.save();
        return res.send({ success: "Login successful!", user: existingUser});
    })
})

/**
 * POST /resend-login-otp
 * Resend OTP to verify mobile no.
 * Also send email to email ID
 */
router.post('/resend-login-otp', async (req, res) => {

    let existingUser

    if(req.body.phone) {
        existingUser = await User.findOne({ phone: req.body.phone, verified: true });
        if(!existingUser) return res.send({ error: "This phone number is not registered!" });
    }

    if(req.body.email) {
        existingUser = await User.findOne({ email: req.body.email, verified: true });
        if(!existingUser) return res.send({ error: "This email ID is not registered!" });
    }

    let otp = Math.floor(1000 + Math.random() * 9000)
    sendOtp.send('91'+existingUser.phone, 'SMVIND', otp, async (err, data, response) => {
        if(err) return res.send({error : err})
        if (data.type !== 'success') return res.send({error : "Could not send OTP. Please retry!"})
        let email = await sendEmail.to(
            existingUser.email,
            "OPT for logging in at StampMyVisa",
            "Your otp is "+otp+". Please do not share with anybody."
        )

        let message = email ? "OTP resent to both email and phone!" : "OTP resent only to phone!"

        existingUser.otp = otp
        await existingUser.save();

        return res.send({ success: message })
    })
})

/**
 * POST /login
 * Login with password
 * expected req {email/phone, password} Prefrence to phone
 */
router.post('/login', async (req, res, next) => {
    req.assert('password', 'Password cannot be blank').notEmpty();
    const error = req.validationErrors();
    if (error) return res.send({error})

    let existingUser

    if(req.body.phone) {
        existingUser = await User.findOne({ phone: req.body.phone, verified: true });
        if(!existingUser) return res.send({ error: "This phone number is not registered!" });
    }

    if(req.body.email) {
        existingUser = await User.findOne({ email: req.body.email, verified: true });
        if(!existingUser) return res.send({ error: "This email ID is not registered!" });
    }

    existingUser.comparePassword(req.body.password, (err, isMatch) => {
        if (err) return res.send({ error: err });
        if (isMatch) {
            req.logIn(existingUser, (err) => {
                if (err) return res.send({error: err});
                return res.send({ success: "Successfully logged in!", user: existingUser });
            })
        } else return res.send({ error: "Password entered is incorrect!" });
    })
})

/**
 * GET /logot
 * Logout user
 */
router.get('/logout', async (req, res) => {
    req.logout();
    res.send({ success: "Logged out!" });
})

module.exports = router