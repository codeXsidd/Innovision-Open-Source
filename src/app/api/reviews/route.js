import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getServerSession } from "@/lib/auth-server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const sortBy = searchParams.get("sortBy") || "newest";

    if (!courseId) {
      return NextResponse.json(
        { error: "Course ID is required" },
        { status: 400 }
      );
    }

    const adminDb = getAdminDb();
    if (!adminDb) {
      return NextResponse.json(
        { error: "Database not available. Check server environment variables." },
        { status: 503 }
      );
    }

    console.log("Fetching reviews for courseId:", courseId, "sortBy:", sortBy);
    const reviewsSnapshot = await adminDb
      .collection("reviews")
      .where("courseId", "==", courseId)
      .get();

    let reviews = [];
    reviewsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.reported) {
        reviews.push({
          id: doc.id,
          ...data,
        });
      }
    });
    if (sortBy === "newest") {
      reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortBy === "oldest") {
      reviews.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortBy === "highest") {
      reviews.sort((a, b) => b.rating - a.rating);
    } else if (sortBy === "lowest") {
      reviews.sort((a, b) => a.rating - b.rating);
    } else if (sortBy === "helpful") {
      reviews.sort((a, b) => (b.helpfulCount || 0) - (a.helpfulCount || 0));
    }

    const ratingDoc = await adminDb
      .collection("courseRatings")
      .doc(courseId)
      .get();

    const ratingStats = ratingDoc.exists
      ? ratingDoc.data()
      : { averageRating: 0, totalReviews: 0 };
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach((review) => {
      distribution[review.rating]++;
    });

    return NextResponse.json({
      success: true,
      reviews,
      stats: {
        ...ratingStats,
        distribution,
      },
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    return NextResponse.json(
      { error: "Failed to fetch reviews", details: error.message },
      { status: 500 }
    );
  }
}

// POST - Submit a new review
export async function POST(request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const adminDb = getAdminDb();
    if (!adminDb) {
      return NextResponse.json(
        { error: "Database not available. Check server environment variables." },
        { status: 503 }
      );
    }

    const { courseId, rating, reviewText } = await request.json();

    // Validation
    if (!courseId) {
      return NextResponse.json(
        { error: "Course ID is required" },
        { status: 400 }
      );
    }

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    if (reviewText && reviewText.length > 1000) {
      return NextResponse.json(
        { error: "Review text must be less than 1000 characters" },
        { status: 400 }
      );
    }

    const userEmail = session.user.email;
    const userName = session.user.name || "Anonymous";
    const userImage = session.user.image || null;

    // Check if user already reviewed this course
    const existingReview = await adminDb
      .collection("reviews")
      .where("courseId", "==", courseId)
      .where("userId", "==", userEmail)
      .get();

    if (!existingReview.empty) {
      return NextResponse.json(
        { error: "You have already reviewed this course. Use PATCH to update." },
        { status: 400 }
      );
    }

    // Create review document
    const reviewData = {
      courseId,
      userId: userEmail,
      userName,
      userImage,
      rating,
      reviewText: reviewText || "",
      helpfulCount: 0,
      notHelpfulCount: 0,
      helpfulVotes: [], // Array of user emails who voted helpful
      notHelpfulVotes: [], // Array of user emails who voted not helpful
      reported: false,
      reportCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const reviewRef = await adminDb.collection("reviews").add(reviewData);

    // Update course average rating
    await updateCourseRating(courseId);

    return NextResponse.json({
      success: true,
      message: "Review submitted successfully",
      reviewId: reviewRef.id,
      review: { id: reviewRef.id, ...reviewData },
    });
  } catch (error) {
    console.error("Error submitting review:", error);
    return NextResponse.json(
      { error: "Failed to submit review" },
      { status: 500 }
    );
  }
}

// Helper function to update course average rating
async function updateCourseRating(courseId) {
  try {
    const adminDb = getAdminDb();
    if (!adminDb) return;

    const reviewsSnapshot = await adminDb
      .collection("reviews")
      .where("courseId", "==", courseId)
      .where("reported", "==", false)
      .get();

    if (reviewsSnapshot.empty) {
      return;
    }

    let totalRating = 0;
    let count = 0;

    reviewsSnapshot.forEach((doc) => {
      totalRating += doc.data().rating;
      count++;
    });

    const averageRating = totalRating / count;

    // Store rating stats in a separate collection for quick access
    await adminDb
      .collection("courseRatings")
      .doc(courseId)
      .set(
        {
          averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
          totalReviews: count,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
  } catch (error) {
    console.error("Error updating course rating:", error);
  }
}
