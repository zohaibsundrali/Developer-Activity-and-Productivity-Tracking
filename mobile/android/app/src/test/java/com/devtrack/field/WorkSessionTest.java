package com.devtrack.field;
import org.junit.Test;
import static org.junit.Assert.*;
public class WorkSessionTest {
    private static final long WALL=1789372800000L;
    @Test public void pauseDoesNotAccrueWorkAndResumeCreatesAnotherSegment() throws Exception {
        WorkSession session=new WorkSession("owner",WALL,1000);session.pause(11000);assertEquals(10,session.seconds(90000));
        session.resume(WALL+90000,91000);session.finish(101000);assertEquals(20,session.seconds(0));assertEquals(2,session.payload().getJSONArray("segments").length());
    }
    @Test public void clockChangesDoNotChangeElapsedWork() {WorkSession session=new WorkSession("owner",WALL,1000);session.tick(6000);assertEquals(WALL+5000,session.lastWall);session.finish(11000);assertEquals(10,session.seconds(0));}
    @Test public void recoveryStopsAtLastPersistedCheckpoint() throws Exception {WorkSession original=new WorkSession("owner",WALL,1000);original.tick(16000);WorkSession restored=new WorkSession(original.saved());restored.recover();assertTrue(restored.complete);assertTrue(restored.recovered);assertEquals(15,restored.seconds(9999999));}
    @Test public void elapsedResetCannotInflateOrErasePersistedTime() {WorkSession session=new WorkSession("owner",WALL,10000);session.tick(20000);session.finish(1);assertTrue(session.recovered);assertEquals(10,session.seconds(0));}
    @Test public void rejectsStaleOrPausedLocationSamples() {WorkSession session=new WorkSession("owner",WALL,1000);assertFalse(session.addPoint(2000,500,1,1,10,false));assertTrue(session.addPoint(2000,2000,1,1,10,false));session.pause(3000);assertFalse(session.addPoint(4000,4000,1,1,10,false));assertEquals(1,session.points.length());}
    @Test public void rejectsDuplicateOrFutureSamples() {WorkSession session=new WorkSession("owner",WALL,1000);assertFalse(session.addPoint(2000,3000,1,1,10,false));assertTrue(session.addPoint(2000,2000,1,1,10,false));assertFalse(session.addPoint(2000,2000,1,1,10,false));}
    @Test public void zeroSecondSegmentDoesNotLeaveUnownedPoints() throws Exception {WorkSession session=new WorkSession("owner",WALL,1000);session.addPoint(1100,1100,1,1,10,false);session.finish(1500);assertEquals(0,session.points.length());assertEquals(0,session.segments.length());}
    @Test public void capsTheWholeSessionAt24Hours() {WorkSession session=new WorkSession("owner",WALL,1000);session.tick(90001000);assertTrue(session.complete);assertEquals(86400,session.seconds(0));}
    @Test public void mockAndBoundaryAccuracyRemainUncertain() {assertEquals("uncertain",Geofence.classify(0,0,10,true,0,0,200));assertEquals("uncertain",Geofence.classify(0,0,300,false,0,0,200));assertEquals("inside",Geofence.classify(0,0,10,false,0,0,200));assertEquals("outside",Geofence.classify(1,1,10,false,0,0,200));}
}
