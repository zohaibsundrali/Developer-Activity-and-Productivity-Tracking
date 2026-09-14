package com.devtrack.field;
public final class Geofence {
    private Geofence() {}
    public static String classify(double lat,double lon,double accuracy,boolean mock,double siteLat,double siteLon,double radius) {
        if(mock || !Double.isFinite(accuracy) || accuracy<0) return "uncertain";
        double a=Math.pow(Math.sin(Math.toRadians(siteLat-lat)/2),2)+Math.cos(Math.toRadians(lat))*Math.cos(Math.toRadians(siteLat))*Math.pow(Math.sin(Math.toRadians(siteLon-lon)/2),2);
        double distance=6371008.8*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
        return distance+accuracy<=radius?"inside":distance-accuracy>radius?"outside":"uncertain";
    }
}
