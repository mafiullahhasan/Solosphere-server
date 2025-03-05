const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const port = process.env.PORT || 9000;
const app = express();
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.v2ezv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://beautiful-dolphin-2511cf.netlify.app",
    ],
    credentials: true,
  })
);

app.use(cookieParser());

app.use(express.json());

// verify jwt
const verifyJwt = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: "Unauthorized access" });

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: "Unauthorized access" });
    console.log(decoded.email);
    req.email = decoded.email;
  });

  next();
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("soloSphere");
    const jobsCollection = db.collection("jobs");
    const bidsCollection = db.collection("bids");

    // generate jwt
    app.post("/jwt", (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "5h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true, message: "Cookie has been sent" });
    });
    // clear cookie
    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({
          success: true,
          message: "Cookie has been remove",
        });
    });

    // get all jobs
    app.get("/all-jobs", async (req, res) => {
      try {
        const { filter, search, sort } = req.query;
        let query = {};
        let options = {};
        if (sort) {
          options = { sort: { deadLine: sort === "asc" ? 1 : -1 } };
        }
        if (search) {
          query.job_title = { $regex: search, $options: "i" };
        }
        if (filter) {
          query.category = filter;
        }

        const result = await jobsCollection.find(query, options).toArray();
        res.send(result);
      } catch (error) {
        console.log("ERROR ON GET ALL JOBS");
      }
    });

    // get all jobs posted by specific user
    app.get("/jobs/:email", verifyJwt, async (req, res) => {
      try {
        const { email } = req.params;
        const decodedEmail = req.email;

        if (decodedEmail !== email)
          return res.status(403).send({ message: "Forbidden access" });

        const query = { "buyerInfo.email": email };
        const result = await jobsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.log("ERROR ON GET MY POSTED JOBS");
      }
    });

    // get specific job by id
    app.get("/job/:id", verifyJwt, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await jobsCollection.findOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.log("ERROR ON GET JOB DETAILS", error);
      }
    });

    // update posted job
    app.put("/update-job/:id", verifyJwt, async (req, res) => {
      try {
        const { id } = req.params;
        const job = req.body;
        const filter = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const updatedJob = {
          $set: job,
        };
        const result = await jobsCollection.updateOne(
          filter,
          updatedJob,
          options
        );
        res.send(result);
      } catch (error) {
        console.log("ERROR ON UPDATE JOB");
      }
    });

    // delete my posted specific job
    app.delete("/job/:id", verifyJwt, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await jobsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.log("ERROR ON DELETE MY POSTED JOB");
      }
    });

    // post a job
    app.post("/add-job", verifyJwt, async (req, res) => {
      try {
        const newJob = req.body;
        console.log(newJob);

        const result = await jobsCollection.insertOne(newJob);
        res.send(result);
      } catch (error) {
        console.log("ERROR ON ADD JOB");
      }
    });

    // bids collection apis
    app.post("/add-bid", verifyJwt, async (req, res) => {
      try {
        const bidData = req.body;
        const { email, jobId } = bidData;
        // already bid this post
        const alreadyExist = await bidsCollection.findOne({
          email,
          jobId,
        });
        if (alreadyExist)
          return res.status(400).send("You already bid this job!");
        const result = await bidsCollection.insertOne(bidData);
        // increment bidCount
        const query = { _id: new ObjectId(jobId) };
        const updatedDoc = {
          $inc: {
            bid_count: 1,
          },
        };
        const updateBidCount = await jobsCollection.updateOne(
          query,
          updatedDoc
        );
        res.send(result);
      } catch (error) {
        console.log("Error on bid post", error.message);
      }
    });
    // get all bids by specific user
    app.get("/bids/:email", verifyJwt, async (req, res) => {
      try {
        const isBuyer = req.query.buyer;
        const email = req.params.email;
        const decodedEmail = req.email;

        if (decodedEmail !== email)
          return res.status(403).send({ message: "Forbidden access" });

        let query = {};
        if (isBuyer) {
          query.buyer = email;
        } else {
          query.email = email;
        }
        const result = await bidsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.log("Error on get all bids specific user", error);
      }
    });

    // update bid status
    app.patch("/bid-status-update/:id", verifyJwt, async (req, res) => {
      try {
        const id = req.params.id;
        console.log(id);

        const query = { _id: new ObjectId(id) };
        const { status } = req.body;
        console.log(status);
        const updateStatus = {
          $set: {
            status: status,
          },
        };
        const result = await bidsCollection.updateOne(query, updateStatus);
        res.send(result);
      } catch (error) {
        console.log("Error on Update bid status", error);
      }
    });

    // get bid request
    // app.get("/bid-requests/:email", async (req, res) => {
    //   try {
    //     const email = req.params.email;
    //     const result = await bidsCollection.find({ buyer: email }).toArray();
    //     res.send(result);
    //   } catch (error) {
    //     console.log("Error on get Bid Request", error);
    //   }
    // });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello from SoloSphere Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
