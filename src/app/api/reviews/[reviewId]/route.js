import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getServerSession } from "@/lib/auth-server";

// PATCH - Update a review
export async function PATCH(request, { params }) {
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

    const { reviewId } = await params;
    const { rating, reviewText } = await request.json();

    if (!reviewId) {
      return NextResponse.json(
        { error: "Review ID is required" },
        { status: 400 }
      );
    }

    // Validation
    if (rating && (rating < 1 || rating > 5)) {
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

    // Get the review
    const reviewRef = adminDb.collection("reviews").doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return NextResponse.json(
        { error: "Review not found" },
        { status: 404 }
      );
    }

    const reviewData = reviewDoc.data();

    // Check if user owns this review
    if (reviewData.userId !== userEmail) {
      return NextResponse.json(
        { error: "You can only edit your own reviews" },
        { status: 403 }
      );
    }

    // Update review
    const updateData = {
      updatedAt: new Date().toISOString(),
    };

    if (rating !== undefined) {
      updateData.rating = rating;
    }

    if (reviewText !== undefined) {
      updateData.reviewText = reviewText;
    }

    await reviewRef.update(updateData);

    // Update course average rating if rating changed
    if (rating !== undefined) {
      await updateCourseRating(reviewData.courseId);
    }

    return NextResponse.json({
      success: true,
      message: "Review updated successfully",
      review: { id: reviewId, ...reviewData, ...updateData },
    });
  } catch (error) {
    console.error("Error updating review:", error);
    return NextResponse.json(
      { error: "Failed to update review" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a review
export async function DELETE(request, { params }) {
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

    const { reviewId } = await params;

    if (!reviewId) {
      return NextResponse.json(
        { error: "Review ID is required" },
        { status: 400 }
      );
    }

    const userEmail = session.user.email;

    // Get the review
    const reviewRef = adminDb.collection("reviews").doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return NextResponse.json(
        { error: "Review not found" },
        { status: 404 }
      );
    }

    const reviewData = reviewDoc.data();

    // Check if user owns this review
    if (reviewData.userId !== userEmail) {
      return NextResponse.json(
        { error: "You can only delete your own reviews" },
        { status: 403 }
      );
    }

    // Delete review
    await reviewRef.delete();

    // Update course average rating
    await updateCourseRating(reviewData.courseId);

    return NextResponse.json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting review:", error);
    return NextResponse.json(
      { error: "Failed to delete review" },
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
      // No reviews left, remove rating stats
      await adminDb.collection("courseRatings").doc(courseId).delete();
      return;
    }

    let totalRating = 0;
    let count = 0;

    reviewsSnapshot.forEach((doc) => {
      totalRating += doc.data().rating;
      count++;
    });

    const averageRating = totalRating / count;

    await adminDb
      .collection("courseRatings")
      .doc(courseId)
      .set(
        {
          averageRating: Math.round(averageRating * 10) / 10,
          totalReviews: count,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
  } catch (error) {
    console.error("Error updating course rating:", error);
  }
}
