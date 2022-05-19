const express = require('express');
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const port = process.env.PORT || 5000
require('dotenv').config()
const stripe = require('stripe')(`${process.env.TEST_API_KEY}`);
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
// middleware 
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mj9wt.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
// console.log('from uri',uri)
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const verifyJwt = (req, res, next) => {
    const header = req.headers.authorization
    if (!header) {
        return res.status(401).send({ message: 'Unauthorized Access' })
    }
    const token = header.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN_PASS, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'Forbidden' })
        }

        req.decoded = decoded
        next()
    });
}

const emailOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}
var emailClient = nodemailer.createTransport(sgTransport(emailOptions));
// send nodemailer 
const sendNodeMailer = (query) => {
    const { email, treatmentName, patientName, slot, date } = query
    var emailSend = {
        from: process.env.EMAIL_SENDER,
        to: email,
        subject: `Your appointment for ${treatmentName} is on ${date} at ${slot} is confirmed`,
        text: 'Your appointment is confirmed',
        html: `
        <div>
        <p>Hello ${patientName}</p>
        <p>Your appointment for ${treatmentName} is confirmed</p>

        <h3>Our Address</h3>
        <p>Dhaka</p>
        <p>12/Mirpur</p>
        </div>
        `
    };
    emailClient.sendMail(emailSend, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });
}


const run = async () => {
    try {
        await client.connect()
        const serviceCollection = client.db('doctorPortals').collection('service')
        const bookingCollection = client.db('doctorPortals').collection('book')
        const userCollection = client.db('doctorPortals').collection('users')
        const doctorCollection = client.db('doctorPortals').collection('doctors')
        const paymentCollection = client.db('doctorPortals').collection('payment')

        const verifyAdmin = async (req, res, next) => {
            const request = req.decoded.email
            const requester = await userCollection.findOne({ email: request })
            if (requester.role === 'Admin') {
                next()
            } else {
                return res.status(403).send('forbiddens')
            }
        }
        app.get('/service', async (req, res) => {
            const query = {}
            const cursor = serviceCollection.find(query)
            const result = await cursor.toArray()
            res.send(result)

        })

        // get all doctor 
        app.get('/manageDoctor', async (req, res) => {
            const result = await doctorCollection.find().toArray()
            res.send(result)
        })

        // get doctor service name 
        app.get('/doctorService', async (req, res) => {
            const result = await serviceCollection.find({}).project({ name: 1 }).toArray()
            res.send(result)
        })

        // add doctor 
        app.post('/addDoctor', verifyJwt, async (req, res) => {
            const body = req.body
            console.log(body)
            const result = await doctorCollection.insertOne(body)
            res.send(result)
            console.log(result)
        })

        // delete doctor 
        app.delete('/delete-doctor/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await doctorCollection.deleteOne(query)
            res.send(result)
        })

        // booked service api
        app.post('/book', async (req, res) => {
            const query = req.body
            console.log(query)
            const filter = { patientName: query.patientName, treatmentName: query.treatmentName, email: query.email }
            const exist = await bookingCollection.findOne(filter)
            
            if (exist) {
                return res.send({ success: false, result: exist })
            }
            sendNodeMailer(query)
            const result = await bookingCollection.insertOne(query)
            res.send({ success: true, result: result })

        })

        // payment api 
        app.get('/payment/:id', async (req, res) => {
            const id = req.params.id
            const filter = { _id: ObjectId(id) }
            const result = await bookingCollection.findOne(filter)
            res.send(result)

        })

        // post payment api 
        app.post("/create-payment-intent", verifyJwt, async (req, res) => {
            const { price } = req.body
            console.log('from body',req.body)
            const amount = price * 100
            console.log("from type of", typeof price)
            const paymentIntent = await stripe.paymentIntents.create({
                amount,
                currency: 'usd',
                payment_method_types: [
                    "card"
                ],

            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        // update user collection 
        app.patch('/update-user/:id',async(req,res)=>{
            const body=req.body
            const id=req.params.id
            console.log(id)
            const filter={_id:ObjectId(id)}
            const options = { upsert: true };
            const updateDoc={
                $set:{
                    paid:true,
                    transactionId:body.transactionId,
                }
            }
            const result=await bookingCollection.updateOne(filter,updateDoc,options)
            const payment=await paymentCollection.insertOne(body)
            console.log(result)
        })

        // available slots 
        app.get('/available', verifyJwt, async (req, res) => {
            const query = {}
            const email = req.query.email
            if (email === req.decoded.email) {
                const date = { date: req.query.date }
                const cursor = serviceCollection.find(query)
                const service = await cursor.toArray()
                const filter = bookingCollection.find(date)
                const result = await filter.toArray()
                service.forEach(elem => {
                    const slots = result.filter(res => res.treatmentName === elem.name)
                    const available = slots.map(s => s.slot)
                    const results = elem.slots.filter(e => !available.includes(e))
                    elem.slots = results
                })
                res.send(service)
            } else {
                res.status(403).send({ message: 'Forbidden' })
            }
        })

        // get admin role 
        app.get('/admin', async (req, res) => {
            const email = req.query.email
            const cursor = await userCollection.findOne({ email })
            const result = cursor?.role === 'Admin'
            res.send(result)
        })

        // get data by email 
        app.get('/myData', verifyJwt, async (req, res) => {
            const email = req.query.email
            if (email === req.decoded.email) {
                const cursor = bookingCollection.find({ email })
                const result = await cursor.toArray()

                res.status(200).send(result)
            } else {
                res.status(403).send({ message: 'Forbidden' })
            }
        })

        // load all user 
        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray()
            res.send(result)

        })

        // create admin 
        app.put('/users/admin/:email', verifyJwt, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const request = req.decoded.email
            const requester = await userCollection.findOne({ email: request })
            const options = { upsert: true };
            const filter = { email };
            const updateDoc = {
                $set: {
                    role: 'Admin'
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            res.send(result)
        })
        // create jwt token 
        app.put('/token', async (req, res) => {
            const email = req.body.email
            const user = req.body
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);

            const accessToken = jwt.sign({ email }, process.env.ACCESS_TOKEN_PASS, { expiresIn: '1d' })
            res.send({ accessToken })
        })


    } finally {

    }
}

run().catch(console.dir)
app.get('/', (req, res) => {
    res.send('Server running')
})
app.listen(port, () => {
    console.log('doctor portals listening', port)
})