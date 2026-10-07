// ================================
// IMPORTS
// ================================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// ================================
// ENVIRONMENT CONFIGURATION
// ================================
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// ================================
// EXPRESS INITIALIZATION
// ================================
const app = express();

// ================================
// MIDDLEWARE
// ================================
app.use(express.json());
app.use(helmet());
app.use(cors({
  origin: CLIENT_URL,
  credentials: true
}));

// ================================
// MONGODB CONNECTION
// ================================
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not defined in environment variables');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => {
    console.log('MongoDB connected successfully');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// ================================
// MONGOOSE SCHEMAS & MODELS
// ================================

// ----- Room Schema -----
const roomSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Room title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  image: {
    type: String,
    required: [true, 'Image URL is required'],
    match: [/^https?:\/\/.+/, 'Please provide a valid image URL']
  },
  floor: {
    type: Number,
    required: [true, 'Floor number is required'],
    min: [0, 'Floor cannot be negative'],
    max: [100, 'Floor cannot exceed 100']
  },
  capacity: {
    type: Number,
    required: [true, 'Capacity is required'],
    min: [1, 'Capacity must be at least 1'],
    max: [50, 'Capacity cannot exceed 50']
  },
  hourlyRate: {
    type: Number,
    required: [true, 'Hourly rate is required'],
    min: [0, 'Hourly rate cannot be negative'],
    max: [1000, 'Hourly rate cannot exceed 1000']
  },
  amenities: {
    type: [String],
    default: []
  },
  ownerId: {
    type: String,
    required: [true, 'Owner ID is required']
  },
  bookingCount: {
    type: Number,
    default: 0,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

roomSchema.index({ ownerId: 1 });
roomSchema.index({ title: 'text', description: 'text' });
roomSchema.index({ createdAt: -1 });
roomSchema.index({ amenities: 1 });

const Room = mongoose.model('Room', roomSchema);

// ----- Booking Schema -----
const bookingSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: [true, 'User ID is required']
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: [true, 'Room ID is required']
  },
  date: {
    type: String,
    required: [true, 'Booking date is required'],
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format']
  },
  startTime: {
    type: String,
    required: [true, 'Start time is required']
  },
  endTime: {
    type: String,
    required: [true, 'End time is required']
  },
  totalCost: {
    type: Number,
    required: true,
    min: [0, 'Total cost cannot be negative']
  },
  specialNote: {
    type: String,
    trim: true,
    maxlength: [500, 'Special note cannot exceed 500 characters'],
    default: ''
  },
  status: {
    type: String,
    enum: ['confirmed', 'cancelled'],
    default: 'confirmed'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

bookingSchema.index({ userId: 1 });
bookingSchema.index({ roomId: 1, date: 1, status: 1 });
bookingSchema.index({ date: 1 });
bookingSchema.index({ status: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

// ================================
// HELPER FUNCTIONS
// ================================

// Valid time slots (hourly, 08:00 - 20:00)
const VALID_TIMES = [
  '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00'
];

// Allowed amenities for rooms
const VALID_AMENITIES = [
  'Whiteboard',
  'Projector',
  'Wi-Fi',
  'Power Outlets',
  'Quiet Zone',
  'Air Conditioning'
];

// Extract current user ID from the Better Auth integration header.
// NOTE: The frontend must send the authenticated Better Auth user ID in the
// x-user-id header. This is a documented limitation: the separate Express
// backend cannot cryptographically verify the Better Auth session from the
// request alone. In production, prefer server-to-server session verification
// with the Better Auth server instead of trusting this header blindly.
const getCurrentUserId = (req) => {
  return req.headers['x-user-id'] || null;
};

// Validate that a value is a valid MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Parse "HH:MM" into an integer hour
const parseTimeToHour = (time) => parseInt(time.split(':')[0], 10);

// Check that a date string (YYYY-MM-DD) is today or in the future
const isValidDate = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bookingDate = new Date(dateStr);
  return bookingDate >= today;
};

// Filter an amenities array down to the allowed set
const filterAmenities = (amenities) => {
  if (!Array.isArray(amenities)) return [];
  return amenities.filter((a) => VALID_AMENITIES.includes(a));
};

// ================================
// ROOM ROUTES
// ================================

// ----- POST /api/rooms : Create a room -----
app.post('/api/rooms', async (req, res) => {
  try {
    const { title, description, image, floor, capacity, hourlyRate, amenities, ownerId } = req.body;

    // Required field validation
    if (!title || !description || !image || floor === undefined || floor === null ||
        !capacity || !hourlyRate || !ownerId) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided: title, description, image, floor, capacity, hourlyRate, amenities, ownerId'
      });
    }

    // Field-level validation
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 100) {
      return res.status(400).json({ success: false, message: 'Room title must be a non-empty string (max 100 characters)' });
    }
    if (typeof description !== 'string' || description.trim().length === 0 || description.length > 1000) {
      return res.status(400).json({ success: false, message: 'Description must be a non-empty string (max 1000 characters)' });
    }
    if (typeof image !== 'string' || !/^https?:\/\/.+/.test(image)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid image URL' });
    }
    const floorNum = Number(floor);
    if (!Number.isFinite(floorNum) || floorNum < 0 || floorNum > 100) {
      return res.status(400).json({ success: false, message: 'Floor must be a number between 0 and 100' });
    }
    const capacityNum = Number(capacity);
    if (!Number.isFinite(capacityNum) || capacityNum < 1 || capacityNum > 50) {
      return res.status(400).json({ success: false, message: 'Capacity must be a number between 1 and 50' });
    }
    const rateNum = Number(hourlyRate);
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 1000) {
      return res.status(400).json({ success: false, message: 'Hourly rate must be a number between 0 and 1000' });
    }

    const filteredAmenities = filterAmenities(amenities);

    const room = await Room.create({
      title: title.trim(),
      description: description.trim(),
      image: image.trim(),
      floor: floorNum,
      capacity: capacityNum,
      hourlyRate: rateNum,
      amenities: filteredAmenities,
      ownerId: String(ownerId),
      bookingCount: 0,
      createdAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: room
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ----- GET /api/rooms : Search & filter rooms -----
app.get('/api/rooms', async (req, res) => {
  try {
    const { search, amenity, floor, minPrice, maxPrice, capacity, limit } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (amenity) {
      const amenities = amenity.split(',').map((a) => a.trim()).filter(Boolean);
      if (amenities.length > 0) {
        query.amenities = { $in: amenities };
      }
    }

    if (floor !== undefined) {
      const floorNum = Number(floor);
      if (Number.isFinite(floorNum)) {
        query.floor = floorNum;
      }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      query.hourlyRate = {};
      if (minPrice !== undefined) query.hourlyRate.$gte = Number(minPrice);
      if (maxPrice !== undefined) query.hourlyRate.$lte = Number(maxPrice);
    }

    if (capacity !== undefined) {
      const capacityNum = Number(capacity);
      if (Number.isFinite(capacityNum)) {
        query.capacity = { $gte: capacityNum };
      }
    }

    let roomsQuery = Room.find(query).sort({ createdAt: -1 });

    if (limit !== undefined) {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        roomsQuery = roomsQuery.limit(limitNum);
      }
    }

    const rooms = await roomsQuery;

    res.json({
      success: true,
      count: rooms.length,
      data: rooms
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ----- GET /api/rooms/my : List rooms owned by current user -----
app.get('/api/rooms/my', async (req, res) => {
  try {
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required. Send it in the x-user-id header.'
      });
    }

    const rooms = await Room.find({ ownerId: currentUserId }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: rooms.length,
      data: rooms
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ----- GET /api/rooms/:id : Get a single room -----
app.get('/api/rooms/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid room ID' });
    }

    const room = await Room.findById(id);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    res.json({
      success: true,
      data: room
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ----- PUT /api/rooms/:id : Update a room (owner only) -----
app.put('/api/rooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required. Send it in the x-user-id header.'
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid room ID' });
    }

    const room = await Room.findById(id);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if (room.ownerId !== currentUserId) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this room' });
    }

    const { title, description, image, floor, capacity, hourlyRate, amenities } = req.body;

    const updateData = {};

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0 || title.length > 100) {
        return res.status(400).json({ success: false, message: 'Room title must be a non-empty string (max 100 characters)' });
      }
      updateData.title = title.trim();
    }

    if (description !== undefined) {
      if (typeof description !== 'string' || description.trim().length === 0 || description.length > 1000) {
        return res.status(400).json({ success: false, message: 'Description must be a non-empty string (max 1000 characters)' });
      }
      updateData.description = description.trim();
    }

    if (image !== undefined) {
      if (typeof image !== 'string' || !/^https?:\/\/.+/.test(image)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid image URL' });
      }
      updateData.image = image.trim();
    }

    if (floor !== undefined) {
      const floorNum = Number(floor);
      if (!Number.isFinite(floorNum) || floorNum < 0 || floorNum > 100) {
        return res.status(400).json({ success: false, message: 'Floor must be a number between 0 and 100' });
      }
      updateData.floor = floorNum;
    }

    if (capacity !== undefined) {
      const capacityNum = Number(capacity);
      if (!Number.isFinite(capacityNum) || capacityNum < 1 || capacityNum > 50) {
        return res.status(400).json({ success: false, message: 'Capacity must be a number between 1 and 50' });
      }
      updateData.capacity = capacityNum;
    }

    if (hourlyRate !== undefined) {
      const rateNum = Number(hourlyRate);
      if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 1000) {
        return res.status(400).json({ success: false, message: 'Hourly rate must be a number between 0 and 1000' });
      }
      updateData.hourlyRate = rateNum;
    }

    if (amenities !== undefined) {
      updateData.amenities = filterAmenities(amenities);
    }

    const updatedRoom = await Room.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    res.json({
      success: true,
      message: 'Room updated successfully',
      data: updatedRoom
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ----- DELETE /api/rooms/:id : Delete a room (owner only) -----
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required. Send it in the x-user-id header.'
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid room ID' });
    }

    const room = await Room.findById(id);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if (room.ownerId !== currentUserId) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this room' });
    }

    await Room.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ================================
// BOOKING ROUTES
// ================================

// ----- POST /api/bookings : Create a booking -----
app.post('/api/bookings', async (req, res) => {
  try {
    const { roomId, date, startTime, endTime, specialNote, userId } = req.body;

    // Required fields
    if (!roomId || !date || !startTime || !endTime || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Room ID, date, start time, end time, and user ID are required'
      });
    }

    if (!isValidObjectId(roomId)) {
      return res.status(400).json({ success: false, message: 'Invalid room ID' });
    }

    // Date must not be in the past
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Date must be in YYYY-MM-DD format' });
    }
    if (!isValidDate(date)) {
      return res.status(400).json({ success: false, message: 'Booking date must be today or a future date' });
    }

    // Valid time slots
    if (!VALID_TIMES.includes(startTime) || !VALID_TIMES.includes(endTime)) {
      return res.status(400).json({ success: false, message: 'Invalid time slot. Allowed times: 08:00 - 20:00' });
    }

    const startHour = parseTimeToHour(startTime);
    const endHour = parseTimeToHour(endTime);

    if (endHour <= startHour) {
      return res.status(400).json({ success: false, message: 'End time must be after start time' });
    }

    if (endHour - startHour < 1) {
      return res.status(400).json({ success: false, message: 'Minimum booking duration is 1 hour' });
    }

    // Room must exist
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    // Conflict detection: overlapping confirmed bookings for the same room/date
    const existingBooking = await Booking.findOne({
      roomId: roomId,
      date: date,
      status: 'confirmed',
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    });

    if (existingBooking) {
      return res.status(409).json({
        success: false,
        message: 'This room is already booked for the selected time.'
      });
    }

    // Server-side cost calculation (never trust frontend totalCost)
    const duration = endHour - startHour;
    const totalCost = duration * room.hourlyRate;

    const booking = await Booking.create({
      userId: String(userId),
      roomId: roomId,
      date,
      startTime,
      endTime,
      totalCost,
      specialNote: specialNote || '',
      status: 'confirmed'
    });

    // Increment room booking count
    await Room.findByIdAndUpdate(roomId, { $inc: { bookingCount: 1 } });

    const populatedBooking = await Booking.findById(booking._id).populate('roomId', 'title image floor capacity hourlyRate amenities');

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: populatedBooking
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ----- GET /api/bookings/my : List current user's bookings -----
app.get('/api/bookings/my', async (req, res) => {
  try {
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required. Send it in the x-user-id header.'
      });
    }

    const bookings = await Booking.find({ userId: currentUserId })
      .populate('roomId', 'title image floor capacity hourlyRate amenities')
      .sort({ date: 1, startTime: 1 });

    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ----- PATCH /api/bookings/:id/cancel : Cancel a booking (owner only) -----
app.patch('/api/bookings/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = getCurrentUserId(req);

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required. Send it in the x-user-id header.'
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.userId !== currentUserId) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this booking' });
    }

    if (booking.status !== 'confirmed') {
      return res.status(400).json({ success: false, message: 'Only confirmed bookings can be cancelled' });
    }

    booking.status = 'cancelled';
    await booking.save();

    // Decrement room booking count, never below zero
    await Room.findByIdAndUpdate(
      booking.roomId,
      { $inc: { bookingCount: -1 } }
    );
    await Room.updateOne(
      { _id: booking.roomId, bookingCount: { $lt: 0 } },
      { $set: { bookingCount: 0 } }
    );

    res.json({
      success: true,
      message: 'Booking cancelled successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ================================
// HEALTH CHECK
// ================================
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'StudyNook API is running'
  });
});

// ================================
// API 404 HANDLER
// ================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found'
  });
});

// ================================
// GLOBAL ERROR HANDLER
// ================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// ================================
// SERVER START
// ================================
app.listen(PORT, () => {
  console.log(`StudyNook server running on port ${PORT}`);
});
